const BASELINE_DATA = {
  currentDAU: {
    commercial_ios: 3550000,
    commercial_android: 2780000,
    consumer_ios: 3180000,
    consumer_android: 8300000
  },
  weeklyAcquisitions: {
    commercial_ios: 317000,
    commercial_android: 334000,
    consumer_ios: 300000,
    consumer_android: 987000
  },
  retentionCurves: {
    existing: {
      d1: 58,
      d7: 51.8,
      d14: 50,
      d28: 48,
      d360: 30,
      d720: 20
    },
    new: {
      d1: 26.4,
      d7: 17.5,
      d14: 15,
      d28: 13,
      d360: 6,
      d720: 3
    }
  }
};

// Power curve function: retention(t) = a * t^(-b)
function fitPowerCurve(retentionData) {
  const points = [
    [1, retentionData.d1 / 100],
    [7, retentionData.d7 / 100],
    [14, retentionData.d14 / 100],
    [28, retentionData.d28 / 100],
    [360, retentionData.d360 / 100],
    [720, retentionData.d720 / 100]
  ];
  
  // Take log of both x and y for linear regression
  const logPoints = points.map(([x, y]) => [Math.log(x), Math.log(y)]);
  
  // Calculate means
  const meanLogX = logPoints.reduce((sum, p) => sum + p[0], 0) / logPoints.length;
  const meanLogY = logPoints.reduce((sum, p) => sum + p[1], 0) / logPoints.length;
  
  // Calculate slope (b) and intercept (log(a))
  let numerator = 0;
  let denominator = 0;
  
  for (const [logX, logY] of logPoints) {
    numerator += (logX - meanLogX) * (logY - meanLogY);
    denominator += (logX - meanLogX) ** 2;
  }
  
  const b = numerator / denominator; // Power law: retention = a * t^(-b), regression gives -b as slope
  const logA = meanLogY + b * meanLogX;
  const a = Math.exp(logA);
  
  return { a, b };
}

// Get retention rate for any day using the power curve
function getRetention(day, powerCurve) {
  return powerCurve.a * Math.pow(day, -powerCurve.b);
}

// Calculate decayed DAU after time
function calculateDecayedDAU(initialDAU, days, powerCurve) {
  if (days <= 0) return initialDAU;
  const retention = getRetention(days, powerCurve);
  return Math.round(initialDAU * retention);
}

// Calculate cohort size over time
function calculateCohortDAU(weeklyAcquisitions, weekNumber, powerCurve, retentionMultiplier = 1) {
  const days = weekNumber * 7;
  if (days <= 0) return 0;
  
  let totalDAU = 0;
  
  // Sum up all cohorts up to this week
  for (let w = 0; w <= weekNumber; w++) {
    const cohortAge = (weekNumber - w) * 7;
    if (cohortAge === 0) {
      // New users in the current week (assume 50% are active on average)
      totalDAU += weeklyAcquisitions * 0.5;
    } else {
      // Apply retention curve and then multiply retention value
      const baseRetention = getRetention(cohortAge, powerCurve);
      const retention = Math.min(1, baseRetention * retentionMultiplier);
      totalDAU += weeklyAcquisitions * retention;
    }
  }
  
  return Math.round(totalDAU);
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      timeHorizon = 52,
      acquisitionChange = {},
      retentionGains = {},
      baselineDecay = 0,
      segments = { commercial: true, consumer: true },
      platforms = { ios: true, android: true },
      exposureRate = 100,
      customBaseline = null
    } = req.body;

    // Use custom baseline if provided, otherwise use default
    const baseline = customBaseline || BASELINE_DATA;

    // Fit power curves for existing and new user retention
    const existingUserCurve = fitPowerCurve(baseline.retentionCurves.existing);
    const newUserCurve = fitPowerCurve(baseline.retentionCurves.new);

    // Initialize results
    const segmentPlatformKeys = [];
    const labels = ['commercial_ios', 'commercial_android', 'consumer_ios', 'consumer_android'];
    
    // Filter based on selected segments and platforms
    for (const label of labels) {
      const [segment, platform] = label.split('_');
      if (segments[segment] && platforms[platform]) {
        segmentPlatformKeys.push(label);
      }
    }

    // Calculate predictions for each segment/platform
    const predictions = {};
    const totals = { baseline: [], predicted: [] };
    
    // Initialize weekly data arrays
    const weeks = Array.from({ length: timeHorizon + 1 }, (_, i) => i);
    
    for (const key of segmentPlatformKeys) {
      const currentDAU = baseline.currentDAU[key];
      const weeklyAcq = baseline.weeklyAcquisitions[key];
      
      // Apply acquisition changes
      const acqMultiplier = 1 + (acquisitionChange[key] || 0) / 100;
      const adjustedAcquisitions = weeklyAcq * acqMultiplier * (exposureRate / 100);
      
      // Calculate retention multipliers for different time periods
      const retentionMultipliers = {
        d1: 1 + (retentionGains.d1Gain || 0),
        d7: 1 + (retentionGains.d7Gain || 0),
        d14: 1 + (retentionGains.d14Gain || 0),
        d28: 1 + (retentionGains.d28Gain || 0),
        d360: 1 + (retentionGains.d360Gain || 0),
        d720: 1 + (retentionGains.d720Gain || 0)
      };
      
      // Average retention multiplier for simplicity
      const avgRetentionMultiplier = Object.values(retentionMultipliers).reduce((a, b) => a + b, 0) / Object.values(retentionMultipliers).length;
      
      const baselineData = [];
      const predictedData = [];
      
      for (const week of weeks) {
        // Baseline: existing users decay + new users with original retention
        const decayedExisting = calculateDecayedDAU(currentDAU, week * 7, existingUserCurve);
        const baselineNewUsers = calculateCohortDAU(weeklyAcq, week, newUserCurve);
        const baselineDAU = decayedExisting + baselineNewUsers;
        
        // Predicted: existing users decay (with baseline decay) + new users with improved retention and acquisition
        const decayMultiplier = 1 - baselineDecay;
        const decayedExistingPredicted = calculateDecayedDAU(currentDAU * decayMultiplier, week * 7, existingUserCurve);
        const predictedNewUsers = calculateCohortDAU(adjustedAcquisitions, week, newUserCurve, avgRetentionMultiplier);
        const predictedDAU = decayedExistingPredicted + predictedNewUsers;
        
        baselineData.push(baselineDAU);
        predictedData.push(predictedDAU);
      }
      
      predictions[key] = {
        baseline: baselineData,
        predicted: predictedData
      };
    }
    
    // Calculate totals
    for (let i = 0; i <= timeHorizon; i++) {
      let baselineSum = 0;
      let predictedSum = 0;
      
      for (const key of segmentPlatformKeys) {
        baselineSum += predictions[key].baseline[i];
        predictedSum += predictions[key].predicted[i];
      }
      
      totals.baseline.push(baselineSum);
      totals.predicted.push(predictedSum);
    }
    
    // Calculate metrics
    const finalBaseline = totals.baseline[timeHorizon];
    const finalPredicted = totals.predicted[timeHorizon];
    const dauGain = finalPredicted - finalBaseline;
    const dauGainPercentage = ((dauGain / finalBaseline) * 100).toFixed(1);
    
    res.status(200).json({
      predictions,
      totals,
      metrics: {
        finalBaseline,
        finalPredicted,
        dauGain,
        dauGainPercentage
      },
      parameters: {
        timeHorizon,
        acquisitionChange,
        retentionGains,
        baselineDecay,
        segments,
        platforms,
        exposureRate
      }
    });
  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ error: 'Failed to generate prediction' });
  }
};