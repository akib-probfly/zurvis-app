const { withAndroidManifest } = require('expo/config-plugins');

const APP_ACTIVITIES = new Set([
  '.MainActivity',
  'com.zurvis.mobile.MainActivity',
]);
const MLKIT_SCANNER_ACTIVITIES = [
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity',
  'com.google.mlkit.vision.documentscanner.internal.GmsDocumentScanningDelegateActivity',
];

function removeActivityOrientation(activity) {
  if (!activity || !activity.$) return;

  const activityName = activity.$['android:name'];
  if (!APP_ACTIVITIES.has(activityName)) return;

  delete activity.$['android:screenOrientation'];
}

function ensureMlkitOrientationOverride(activities, activityName) {
  const existing = activities.find(
    (activity) => activity?.$?.['android:name'] === activityName,
  );

  if (existing) {
    existing.$['tools:remove'] = mergeToolsRemove(existing.$['tools:remove']);
    return;
  }

  activities.push({
    $: {
      'android:name': activityName,
      'tools:remove': 'android:screenOrientation',
    },
  });
}

function mergeToolsRemove(value) {
  const removals = new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  removals.add('android:screenOrientation');
  return Array.from(removals).join(',');
}

module.exports = function removeAndroidLargeScreenRestrictions(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];

    activities.forEach(removeActivityOrientation);
    MLKIT_SCANNER_ACTIVITIES.forEach((activityName) => {
      ensureMlkitOrientationOverride(activities, activityName);
    });

    return configWithManifest;
  });
};
