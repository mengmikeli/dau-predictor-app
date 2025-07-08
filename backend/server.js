const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// Default baseline data with segment/platform granularity
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
  
  // Simple power curve fitting using least squares on log-transformed data
  const logPoints = points.map(([t, r]) => [Math.log(t), Math.log(Math.max(r, 0.001))]);
  const n = logPoints.length;
  const sumX = logPoints.reduce((sum, [x]) => sum + x, 0);
  const sumY = logPoints.reduce((sum, [, y]) => sum + y, 0);
  const sumXY = logPoints.reduce((sum, [x, y]) => sum + x * y, 0);
  const sumX2 = logPoints.reduce((sum, [x]) => sum + x * x, 0);
  
  const b = -(n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const logA = (sumY + b * sumX) / n;
  const a = Math.exp(logA);
  
  // Calculate R-squared
  const meanY = sumY / n;
  let ssTotal = 0;
  let ssResidual = 0;
  
  for (let i = 0; i < points.length; i++) {
    const [t, actualR] = points[i];
    const predictedR = a * Math.pow(t, -b);
    const logActual = Math.log(Math.max(actualR, 0.001));
    const logPredicted = Math.log(predictedR);
    
    ssTotal += (logActual - meanY) ** 2;
    ssResidual += (logActual - logPredicted) ** 2;
  }
  
  const rSquared = Math.max(0, 1 - ssResidual / ssTotal);
  
  return { a, b, rSquared, type: 'power' };
}

// Exponential decay function: retention(t) = c + a * e^(-λt)
function fitExponentialDecay(retentionData) {
  const points = [
    [1, retentionData.d1 / 100],
    [7, retentionData.d7 / 100],
    [14, retentionData.d14 / 100],
    [28, retentionData.d28 / 100],
    [360, retentionData.d360 / 100],
    [720, retentionData.d720 / 100]
  ];
  
  // Estimate asymptote (c) as the minimum retention value
  const minRetention = Math.min(...points.map(([, r]) => r));
  const c = Math.max(0, minRetention * 0.8); // Set floor slightly below minimum
  
  // Transform data: ln(retention - c) = ln(a) - λt
  const transformedPoints = points.map(([t, r]) => [t, Math.log(Math.max(r - c, 0.001))]);
  const n = transformedPoints.length;
  const sumX = transformedPoints.reduce((sum, [x]) => sum + x, 0);
  const sumY = transformedPoints.reduce((sum, [, y]) => sum + y, 0);
  const sumXY = transformedPoints.reduce((sum, [x, y]) => sum + x * y, 0);
  const sumX2 = transformedPoints.reduce((sum, [x]) => sum + x * x, 0);
  
  const lambda = -(n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const logA = (sumY + lambda * sumX) / n;
  const a = Math.exp(logA);
  
  // Calculate R-squared
  const meanY = sumY / n;
  let ssTotal = 0;
  let ssResidual = 0;
  
  for (let i = 0; i < points.length; i++) {
    const [t, actualR] = points[i];
    const predictedR = c + a * Math.exp(-lambda * t);
    const actualTransformed = Math.log(Math.max(actualR - c, 0.001));
    const predictedTransformed = Math.log(Math.max(predictedR - c, 0.001));
    
    ssTotal += (actualTransformed - meanY) ** 2;
    ssResidual += (actualTransformed - predictedTransformed) ** 2;
  }
  
  const rSquared = Math.max(0, 1 - ssResidual / ssTotal);
  
  return { a, lambda, c, rSquared, type: 'exponential' };
}

function getRetentionAtDay(params, day) {
  // Handle D0 case (day 0 = 100% retention for new users)
  if (day === 0) {
    return 1.0; // 100% retention on signup day
  }
  
  if (params.type === 'exponential') {
    return Math.min(1, Math.max(0, params.c + params.a * Math.exp(-params.lambda * day)));
  } else {
    return Math.min(1, params.a * Math.pow(day, -params.b));
  }
}

// Calculate DAU impact with sophisticated modeling
function calculateDAUimpact(params) {
  const { 
    initiativeType, 
    acquisition, 
    retention, 
    baselineDecay = 0.0017, // ~5% monthly churn
    segments = { commercial: true, consumer: true },
    platforms = { ios: true, android: true },
    exposureRate = 100,
    customBaseline = null
  } = params;
  
  // Use custom baseline data if provided, otherwise use default
  const baselineData = customBaseline || BASELINE_DATA;
  
  // Calculate targeted DAU and acquisitions based on segments/platforms
  let totalCurrentDAU = 0;
  let dailyAcquisitions = 0;
  
  Object.entries(baselineData.currentDAU).forEach(([key, value]) => {
    const [segment, platform] = key.split('_');
    if (segments[segment] && platforms[platform]) {
      totalCurrentDAU += value;
    }
  });
  
  Object.entries(baselineData.weeklyAcquisitions).forEach(([key, value]) => {
    const [segment, platform] = key.split('_');
    if (segments[segment] && platforms[platform]) {
      dailyAcquisitions += value / 7;
    }
  });
  
  // Pre-calculate retention curves
  const baseNewUserCurve = fitPowerCurve(baselineData.retentionCurves.new);
  const baseExistingUserCurve = fitExponentialDecay(baselineData.retentionCurves.existing);
  
  // Calculate improved retention curves if retention experiment is active
  let improvedNewUserCurve = baseNewUserCurve;
  let improvedExistingUserCurve = baseExistingUserCurve;
  
  if (initiativeType === 'retention' || initiativeType === 'combined') {
    if (retention.targetUsers === 'new' || retention.targetUsers === 'all') {
      const improvedNewRetention = {
        d1: Math.min(100, baselineData.retentionCurves.new.d1 + (retention.d1Gain || 0)),
        d7: Math.min(100, baselineData.retentionCurves.new.d7 + (retention.d7Gain || 0)),
        d14: Math.min(100, baselineData.retentionCurves.new.d14 + (retention.d14Gain || 0)),
        d28: Math.min(100, baselineData.retentionCurves.new.d28 + (retention.d28Gain || 0)),
        d360: Math.min(100, baselineData.retentionCurves.new.d360 + (retention.d360Gain || 0)),
        d720: Math.min(100, baselineData.retentionCurves.new.d720 + (retention.d720Gain || 0))
      };
      improvedNewUserCurve = fitPowerCurve(improvedNewRetention);
    }
    
    if (retention.targetUsers === 'existing' || retention.targetUsers === 'all') {
      const improvedExistingRetention = {
        d1: Math.min(100, baselineData.retentionCurves.existing.d1 + (retention.d1Gain || 0)),
        d7: Math.min(100, baselineData.retentionCurves.existing.d7 + (retention.d7Gain || 0)),
        d14: Math.min(100, baselineData.retentionCurves.existing.d14 + (retention.d14Gain || 0)),
        d28: Math.min(100, baselineData.retentionCurves.existing.d28 + (retention.d28Gain || 0)),
        d360: Math.min(100, baselineData.retentionCurves.existing.d360 + (retention.d360Gain || 0)),
        d720: Math.min(100, baselineData.retentionCurves.existing.d720 + (retention.d720Gain || 0))
      };
      improvedExistingUserCurve = fitExponentialDecay(improvedExistingRetention);
    }
  }
  
  const results = {
    baseline: [],
    withInitiative: [],
    incrementalDAU: [],
    summary: {
      totalImpact: 0,
      peakImpact: 0,
      peakMonth: 0,
      peakLiftPercent: 0,
      breakdown: {
        existingUsers: 0,
        newUsers: 0,
        newAcquisition: 0
      }
    },
    retentionCurves: {
      baseNewUser: baseNewUserCurve,
      improvedNewUser: improvedNewUserCurve,
      baseExistingUser: baseExistingUserCurve,
      improvedExistingUser: improvedExistingUserCurve
    }
  };
  
  // Daily retention rate for existing users (5% monthly churn = 95% retention)
  const dailyRetentionRate = Math.pow(0.95, 1/30);
  
  // Calculate daily DAU for 365 days
  for (let day = 0; day < 365; day++) {
    // === BASELINE DAU ===
    // Existing users baseline with simple decay
    const existingUserBaselineDAU = totalCurrentDAU * Math.pow(dailyRetentionRate, day);
    
    // New users baseline from all cohorts acquired up to this day
    let newUserBaselineDAU = 0;
    for (let cohortDay = 0; cohortDay < day; cohortDay++) {
      const cohortAge = day - cohortDay;
      const retention = getRetentionAtDay(baseNewUserCurve, cohortAge);
      newUserBaselineDAU += dailyAcquisitions * retention;
    }
    
    const baselineDAU = existingUserBaselineDAU + newUserBaselineDAU;
    
    // === INCREMENTAL DAU ===
    let existingUserIncrementalDAU = 0;
    let newUserIncrementalDAU = 0;
    let newAcquisitionDAU = 0;
    
    // Retention experiment impact
    if (initiativeType === 'retention' || initiativeType === 'combined') {
      const experimentStartDay = retention.monthsToStart * 30;
      
      if (day >= experimentStartDay) {
        const daysSinceExperiment = day - experimentStartDay;
        
        // Existing users impact
        if (retention.targetUsers === 'existing' || retention.targetUsers === 'all') {
          const experimentExistingUsers = totalCurrentDAU * Math.pow(dailyRetentionRate, experimentStartDay);
          const exposedExistingUsers = experimentExistingUsers * (exposureRate / 100);
          
          if (daysSinceExperiment >= 1) {
            const baseRetention = getRetentionAtDay(baseExistingUserCurve, daysSinceExperiment);
            const improvedRetention = getRetentionAtDay(improvedExistingUserCurve, daysSinceExperiment);
            const retentionUplift = Math.max(0, improvedRetention - baseRetention);
            
            existingUserIncrementalDAU = exposedExistingUsers * retentionUplift;
          }
        }
        
        // New users impact
        if (retention.targetUsers === 'new' || retention.targetUsers === 'all') {
          const exposedDailyAcq = dailyAcquisitions * (exposureRate / 100);
          
          // Calculate incremental DAU from all new user cohorts acquired since experiment
          for (let cohortDay = experimentStartDay; cohortDay < day; cohortDay++) {
            const cohortAge = day - cohortDay;
            const baseRetention = getRetentionAtDay(baseNewUserCurve, cohortAge);
            const improvedRetention = getRetentionAtDay(improvedNewUserCurve, cohortAge);
            const retentionUplift = Math.max(0, improvedRetention - baseRetention);
            
            newUserIncrementalDAU += exposedDailyAcq * retentionUplift;
          }
        }
      }
    }
    
    // Acquisition campaign impact
    if (initiativeType === 'acquisition' || initiativeType === 'combined') {
      const campaignStartDay = acquisition.weeksToStart * 7;
      const campaignEndDay = campaignStartDay + (acquisition.duration * 7);
      
      // Simple campaign: full volume for the entire duration
      if (day >= campaignStartDay && day < campaignEndDay) {
        const dailyNewAcq = acquisition.weeklyInstalls / 7;
        
        // Calculate DAU from all campaign cohorts acquired up to this day
        for (let cohortDay = campaignStartDay; cohortDay <= Math.min(day, campaignEndDay - 1); cohortDay++) {
          const cohortAge = day - cohortDay;
          const retention = getRetentionAtDay(baseNewUserCurve, cohortAge);
          newAcquisitionDAU += dailyNewAcq * retention;
        }
      }
    }
    
    const incrementalDAU = existingUserIncrementalDAU + newUserIncrementalDAU + newAcquisitionDAU;
    
    results.baseline.push(Math.round(baselineDAU));
    results.withInitiative.push(Math.round(baselineDAU + incrementalDAU));
    results.incrementalDAU.push(Math.round(incrementalDAU));
    
    // Update summary stats
    if (incrementalDAU > results.summary.peakImpact) {
      results.summary.peakImpact = incrementalDAU;
      results.summary.peakMonth = Math.floor(day / 30) + 1;
      results.summary.peakLiftPercent = (incrementalDAU / baselineDAU) * 100;
    }
    
    results.summary.totalImpact += incrementalDAU;
    results.summary.breakdown.existingUsers += existingUserIncrementalDAU;
    results.summary.breakdown.newUsers += newUserIncrementalDAU;
    results.summary.breakdown.newAcquisition += newAcquisitionDAU;
  }
  
  // Round summary values
  results.summary.totalImpact = Math.round(results.summary.totalImpact);
  results.summary.peakImpact = Math.round(results.summary.peakImpact);
  results.summary.peakLiftPercent = Math.round(results.summary.peakLiftPercent * 10) / 10;
  results.summary.breakdown.existingUsers = Math.round(results.summary.breakdown.existingUsers);
  results.summary.breakdown.newUsers = Math.round(results.summary.breakdown.newUsers);
  results.summary.breakdown.newAcquisition = Math.round(results.summary.breakdown.newAcquisition);
  
  return results;
}

app.post('/api/predict', (req, res) => {
  try {
    const results = calculateDAUimpact(req.body);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});