import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import {
  answerConversationCall,
  declineConversationCall,
  endConversationCall,
  startConversationCall,
  type ConversationCallSignalSession,
} from '../api/inbox';
import {
  createWhatsappCallAnswer,
  createWhatsappCallOffer,
  createWhatsappCallPeerContext,
  disposeWhatsappCallPeerContext,
  extractWhatsappCallSignal,
  isWhatsappCallSupported,
  type WhatsappCallPeerContext,
} from '../lib/whatsapp-calling';
import { MediaStream, RTCSessionDescription } from '../native/webrtc';
import { releaseCallSession, scheduleCallAudioReapply } from '../lib/audio-session';
import { performVerifiedCallAction, reconcileCallSuccess, reconcileCallActionError, isCallStateError, callStateErrorMessage } from '../lib/call-session-reconciliation';

export type CallConnectionState =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export function useWhatsappCallController() {
  const queryClient = useQueryClient();
  const startCallMutation = useMutation({ mutationFn: startConversationCall, onSuccess: (current) => reconcileCallSuccess(queryClient, current) });
  const answerCallMutation = useMutation({
    mutationFn: (params: Parameters<typeof answerConversationCall>[0]) => performVerifiedCallAction(params, 'answer', answerConversationCall),
    onSuccess: (current) => reconcileCallSuccess(queryClient, current),
    onError: (error, params) => reconcileCallActionError(queryClient, error, params),
  });
  const declineCallMutation = useMutation({
    mutationFn: (params: Parameters<typeof declineConversationCall>[0]) => performVerifiedCallAction(params, 'decline', declineConversationCall),
    onSuccess: (current) => reconcileCallSuccess(queryClient, current),
    onError: (error, params) => reconcileCallActionError(queryClient, error, params),
  });
  const endCallMutation = useMutation({
    mutationFn: (params: Parameters<typeof endConversationCall>[0]) => performVerifiedCallAction(params, 'end', endConversationCall),
    onSuccess: (current) => reconcileCallSuccess(queryClient, current),
    onError: (error, params) => reconcileCallActionError(queryClient, error, params),
  });
  const peerContextRef = useRef<WhatsappCallPeerContext | null>(null);
  const peerGenerationRef = useRef(0);
  const [peerCallIdentity, setPeerCallIdentity] = useState<{ conversationId: string; callSessionId: string } | null>(null);
  const appliedRemoteSignalRef = useRef<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<any | null>(null);
  const [connectionState, setConnectionState] = useState<CallConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const pendingActionRef = useRef(false);
  const [actionPending, setActionPending] = useState(false);
  const beginAction = useCallback(() => {
    if (pendingActionRef.current) return false;
    pendingActionRef.current = true; setActionPending(true); return true;
  }, []);
  const finishAction = useCallback(() => { pendingActionRef.current = false; setActionPending(false); }, []);


  useEffect(() => {
    if (Platform.OS !== 'ios' || connectionState !== 'connected') return;
    const context = peerContextRef.current;
    if (!context) return;
    let cancelled = false;
    let pending = false;
    const sample = async () => {
      if (pending) return;
      pending = true;
      try {
        const stats = await context.peerConnection.getStats();
        if (cancelled || peerContextRef.current !== context) return;
        const audio: Record<string, unknown>[] = [];
        stats.forEach((report: Record<string, unknown>) => {
          if (report.kind !== 'audio' && report.mediaType !== 'audio') return;
          if (!['inbound-rtp', 'outbound-rtp', 'media-source'].includes(String(report.type))) return;
          // Only audio counters: never log SDP, addresses, or customer data.
          const entry: Record<string, unknown> = { type: report.type };
          for (const key of ['bytesReceived', 'bytesSent', 'packetsReceived', 'packetsSent', 'packetsLost', 'audioLevel', 'totalAudioEnergy', 'totalSamplesReceived']) {
            if (typeof report[key] === 'number') entry[key] = report[key];
          }
          audio.push(entry);
        });
        console.info('[call-audio] Media', JSON.stringify({
          connection: context.peerConnection.connectionState,
          ice: context.peerConnection.iceConnectionState,
          microphone: context.localStream.getAudioTracks().map((track: any) => ({ enabled: track.enabled, readyState: track.readyState })),
          audio,
        }));
      } catch (error) {
        if (!cancelled) console.warn('[call-audio] Stats unavailable', error);
      } finally {
        pending = false;
      }
    };
    void sample();
    const timer = setInterval(() => { void sample(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [connectionState]);

  const syncLocalAudioTracks = useCallback((enabled: boolean) => {
    const localStream = peerContextRef.current?.localStream;
    if (!localStream) return false;
    localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = enabled;
    });
    setIsMuted(!enabled);
    return true;
  }, []);

  const resetPeerContext = useCallback((options?: { restoreAudio?: boolean }) => {
    peerGenerationRef.current++;
    const context = peerContextRef.current;
    peerContextRef.current = null;
    if (context) {
      try { disposeWhatsappCallPeerContext(context); }
      catch (error) { console.warn('[call-audio] Peer cleanup failed', error); }
    }
    setPeerCallIdentity(null);
    appliedRemoteSignalRef.current = null;
    setRemoteStream(null);
    setIsMuted(false);
    setConnectionState('idle');
    if (options?.restoreAudio !== false) {
      void releaseCallSession().catch(() => {});
    }
  }, []);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const toggleMute = useCallback(() => {
    const localStream = peerContextRef.current?.localStream;
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    const shouldEnable = audioTracks.some((track: any) => !track.enabled);
    syncLocalAudioTracks(shouldEnable);
  }, [syncLocalAudioTracks]);

  const attachPeerListeners = useCallback((peerConnection: any) => {
    const applyRemoteStream = (stream: any, track?: any) => {
      if (track) {
        try { track.enabled = true; } catch {}
      }
      if (stream) {
        stream.getAudioTracks?.().forEach((audioTrack: any) => {
          try { audioTrack.enabled = true; } catch {}
        });
        setRemoteStream(stream);
        scheduleCallAudioReapply();
        return;
      }
      if (!track) return;
      try {
        const fallback = new MediaStream([track]);
        setRemoteStream(fallback);
      } catch {
        try {
          const fallback = new MediaStream();
          fallback.addTrack?.(track);
          setRemoteStream(fallback);
        } catch {}
      }
    };

    peerConnection.ontrack = (event: { streams?: any[]; track: any }) => {
      applyRemoteStream(event.streams?.[0], event.track);
    };
    peerConnection.onaddstream = (event: { stream?: any }) => {
      applyRemoteStream(event.stream);
    };

    peerConnection.onconnectionstatechange = () => {
      switch (peerConnection.connectionState) {
        case 'connected':
          setConnectionState('connected');
          scheduleCallAudioReapply();
          break;
        case 'connecting':
          setConnectionState('connecting');
          break;
        case 'disconnected':
          setConnectionState('disconnected');
          break;
        case 'failed':
          setConnectionState('failed');
          break;
        default:
          break;
      }
    };
    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
        scheduleCallAudioReapply();
      }
    };
  }, []);

  const initializePeerContext = useCallback(async () => {
    if (!isWhatsappCallSupported()) {
      throw new Error('Voice calling requires a custom Expo build with WebRTC.');
    }
    resetPeerContext({ restoreAudio: false });
    const generation = peerGenerationRef.current;
    const peerContext = await createWhatsappCallPeerContext();
    if (generation !== peerGenerationRef.current) {
      disposeWhatsappCallPeerContext(peerContext);
      throw new Error('Call setup was cancelled.');
    }
    attachPeerListeners(peerContext.peerConnection);
    peerContextRef.current = peerContext;
    setIsMuted(false);
    return peerContext;
  }, [attachPeerListeners, resetPeerContext]);

  const applyRemoteSignal = useCallback(async (signal: ConversationCallSignalSession | null) => {
    if (!signal || !peerContextRef.current) return;
    const signature = `${signal.sdpType}:${signal.sdp}`;
    if (appliedRemoteSignalRef.current === signature) return;

    const peerConnection = peerContextRef.current.peerConnection;
    // Ignore echoed local answers and stale realtime signals, matching web.
    if ((signal.sdpType === 'answer' && peerConnection.signalingState !== 'have-local-offer')
      || (signal.sdpType === 'offer' && peerConnection.signalingState !== 'stable')) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription({
      type: signal.sdpType,
      sdp: signal.sdp,
    }));
    appliedRemoteSignalRef.current = signature;
  }, []);

  const startOutboundCall = useCallback(async (params: { conversationId: string; note?: string | null }) => {
    if (!beginAction()) return;
    clearError();
    setConnectionState('preparing');
    try {
      const peerContext = await initializePeerContext();
      const offer = await createWhatsappCallOffer(peerContext.peerConnection);
      setConnectionState('connecting');
      const session = await startCallMutation.mutateAsync({
        conversationId: params.conversationId,
        note: params.note ?? null,
        session: offer,
      });
      setPeerCallIdentity({ conversationId: params.conversationId, callSessionId: session.id });

      const remoteSignal = extractWhatsappCallSignal(session.metadata);
      if (remoteSignal?.sdpType === 'answer') {
        await applyRemoteSignal(remoteSignal);
      }

      if (session.status === 'PERMISSION_REQUESTED') {
        Toast.show({
          type: 'success',
          text1: 'Permission message sent',
          text2: 'Waiting for the customer to approve WhatsApp calling.',
        });
      } else {
        Toast.show({
          type: 'success',
          text1: session.provider?.toLowerCase() === 'webchat' ? 'Web chat call started' : 'WhatsApp call started',
          text2: session.status === 'CONNECTED' ? 'The call connected successfully.' : 'The call is ringing now.',
        });
      }

      if (session.status !== 'RINGING' && session.status !== 'CONNECTED') {
        resetPeerContext();
        setConnectionState('idle');
      }

      return session;
    } catch (error) {
      resetPeerContext();
      setConnectionState('failed');
      const message = error instanceof Error ? error.message : 'Could not start the voice call';
      Toast.show({ type: 'error', text1: 'Could not start the voice call', text2: message });
      setErrorMessage(message);
    } finally {
      finishAction();
    }
  }, [beginAction, finishAction, applyRemoteSignal, clearError, initializePeerContext, resetPeerContext, startCallMutation]);

  const answerCall = useCallback(async (params: {
    conversationId: string;
    callSessionId: string;
    remoteOffer: ConversationCallSignalSession;
    bizOpaqueCallbackData?: string | null;
  }) => {
    if (!beginAction()) return;
    clearError();
    setConnectionState('preparing');
    try {
      const peerContext = await initializePeerContext();
      setPeerCallIdentity({ conversationId: params.conversationId, callSessionId: params.callSessionId });
      const answer = await createWhatsappCallAnswer(peerContext.peerConnection, params.remoteOffer);
      setConnectionState('connecting');
      const session = await answerCallMutation.mutateAsync({
        conversationId: params.conversationId,
        callSessionId: params.callSessionId,
        bizOpaqueCallbackData: params.bizOpaqueCallbackData ?? null,
        session: answer,
      });
      const remoteSignal = extractWhatsappCallSignal(session.metadata);
      if (remoteSignal?.sdpType === 'answer') {
        await applyRemoteSignal(remoteSignal);
      }
      return session;
    } catch (error) {
      resetPeerContext();
      setConnectionState('failed');
      const message = callStateErrorMessage(error) ?? (error instanceof Error ? error.message : 'Could not answer the voice call');
      Toast.show({ type: isCallStateError(error) ? 'info' : 'error', text1: isCallStateError(error) ? 'Call state changed' : 'Could not answer the call', text2: message });
      setErrorMessage(message);
    } finally {
      finishAction();
    }
  }, [beginAction, finishAction, answerCallMutation, applyRemoteSignal, clearError, initializePeerContext, resetPeerContext]);

  const declineCall = useCallback(async (params: { conversationId: string; callSessionId: string }) => {
    if (!beginAction()) return;
    clearError();
    try {
      const session = await declineCallMutation.mutateAsync(params);
      resetPeerContext();
      return session;
    } catch (error) {
      setConnectionState('failed');
      const message = callStateErrorMessage(error) ?? (error instanceof Error ? error.message : 'Could not decline the voice call');
      if (isCallStateError(error)) Toast.show({ type: 'info', text1: 'Call state changed', text2: message });
      setErrorMessage(message);
    } finally {
      finishAction();
    }
  }, [beginAction, finishAction, clearError, declineCallMutation, resetPeerContext]);

  const endCall = useCallback(async (params: { conversationId: string; callSessionId: string }) => {
    if (!beginAction()) return;
    clearError();
    // Local privacy must not depend on preflight, network, or cache reconciliation.
    resetPeerContext();
    try {
      const session = await endCallMutation.mutateAsync(params);
      return session;
    } catch (error) {
      setConnectionState('failed');
      const message = callStateErrorMessage(error) ?? (error instanceof Error ? error.message : 'Could not end the voice call');
      if (isCallStateError(error)) Toast.show({ type: 'info', text1: 'Call state changed', text2: message });
      setErrorMessage(message);
    } finally {
      finishAction();
    }
  }, [beginAction, finishAction, clearError, endCallMutation, resetPeerContext]);

  useEffect(() => () => {
    resetPeerContext();
  }, [resetPeerContext]);

  return {
    peerCallIdentity,
    connectionState,
    errorMessage,
    isMuted,
    isBusy:
      actionPending || startCallMutation.isPending
      || answerCallMutation.isPending
      || declineCallMutation.isPending
      || endCallMutation.isPending,
    remoteStream,
    clearError,
    applyRemoteSignal,
    resetPeerContext,
    toggleMute,
    startOutboundCall,
    answerCall,
    declineCall,
    endCall,
  };
}
