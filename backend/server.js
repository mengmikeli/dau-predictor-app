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
      
      // Validate acquisition parameters
      if (acquisition.weeklyInstalls > 0 && acquisition.duration > 0) {
        // Calculate DAU from acquisition campaign cohorts
        if (day >= campaignStartDay) {
          const dailyNewAcq = acquisition.weeklyInstalls / 7;
          
          // Calculate DAU from all campaign cohorts acquired up to this day
          // During campaign: acquire users daily until campaign ends
          // After campaign: continue calculating DAU from previously acquired cohorts
          const lastAcquisitionDay = Math.min(day, campaignEndDay - 1);
          
          for (let cohortDay = campaignStartDay; cohortDay <= lastAcquisitionDay; cohortDay++) {
            const cohortAge = day - cohortDay;
            const retention = getRetentionAtDay(baseNewUserCurve, cohortAge);
            newAcquisitionDAU += dailyNewAcq * retention;
          }
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
    console.log('=== PREDICTION REQUEST RECEIVED ===');
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    console.log('Initiative Type:', req.body.initiativeType);
    console.log('Acquisition Params:', JSON.stringify(req.body.acquisition, null, 2));
    console.log('Validation Check: weeklyInstalls > 0?', req.body.acquisition.weeklyInstalls > 0);
    console.log('Validation Check: duration > 0?', req.body.acquisition.duration > 0);
    console.log('Will process acquisition?', req.body.acquisition.weeklyInstalls > 0 && req.body.acquisition.duration > 0);
    
    const results = calculateDAUimpact(req.body);
    
    console.log('=== PREDICTION RESULTS ===');
    console.log('Peak Impact:', results.summary.peakImpact);
    console.log('Total Impact:', results.summary.totalImpact);
    console.log('New Acquisition Breakdown:', results.summary.breakdown.newAcquisition);
    console.log('========================');
    
    res.json(results);
  } catch (error) {
    console.error('Prediction Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Basic test cases for acquisition debugging
function runAcquisitionTests() {
  console.log('\n=== RUNNING ACQUISITION DEBUG TESTS ===\n');
  
  // Test 1: Simple acquisition campaign
  const testCase1 = {
    initiativeType: 'acquisition',
    acquisition: {
      weeklyInstalls: 70000, // 10K daily
      weeksToStart: 0, // Start immediately
      duration: 4 // 4 weeks
    },
    retention: {
      targetUsers: 'new',
      monthsToStart: 0,
      d1Gain: 0,
      d7Gain: 0,
      d14Gain: 0,
      d28Gain: 0,
      d360Gain: 0,
      d720Gain: 0
    },
    baselineDecay: 0.0017,
    segments: { commercial: true, consumer: true },
    platforms: { ios: true, android: true },
    exposureRate: 100,
    customBaseline: null
  };
  
  console.log('TEST 1: Basic Acquisition Campaign');
  console.log('Parameters:', JSON.stringify(testCase1.acquisition, null, 2));
  
  try {
    const result1 = calculateDAUimpact(testCase1);
    console.log('Peak Impact:', result1.summary.peakImpact);
    console.log('Total Impact:', result1.summary.totalImpact);
    console.log('New Acquisition Impact:', result1.summary.breakdown.newAcquisition);
    console.log('Sample DAU values (first 10 days):');
    for (let i = 0; i < 10; i++) {
      console.log(`  Day ${i}: Baseline=${result1.baseline[i]}, WithInitiative=${result1.withInitiative[i]}, Incremental=${result1.incrementalDAU[i]}`);
    }
  } catch (error) {
    console.error('TEST 1 FAILED:', error.message);
  }
  
  console.log('\n--- Test 2: Check Retention Curves ---');
  
  // Test retention function directly
  const baseNewUserCurve = fitPowerCurve(BASELINE_DATA.retentionCurves.new);
  console.log('Base New User Curve:', baseNewUserCurve);
  
  console.log('Retention at different days:');
  for (let day of [0, 1, 7, 14, 28, 60]) {
    const retention = getRetentionAtDay(baseNewUserCurve, day);
    console.log(`  Day ${day}: ${(retention * 100).toFixed(2)}%`);
  }
  
  console.log('\n--- Test 3: Manual Calculation ---');
  
  // Manual calculation for day 1 of campaign
  const dailyAcq = 70000 / 7; // 10K daily
  const day0Retention = getRetentionAtDay(baseNewUserCurve, 0); // Should be 1.0
  const day1Retention = getRetentionAtDay(baseNewUserCurve, 1); // Should be ~0.264
  
  console.log('Daily acquisition:', dailyAcq);
  console.log('Day 0 retention:', day0Retention);
  console.log('Day 1 retention:', day1Retention);
  console.log('Expected Day 0 DAU:', dailyAcq * day0Retention);
  console.log('Expected Day 1 DAU from D0 cohort:', dailyAcq * day1Retention);
  
  console.log('\n=== END ACQUISITION TESTS ===\n');
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  
  // Run tests after server starts
  setTimeout(() => {
    runAcquisitionTests();
  }, 100);
});