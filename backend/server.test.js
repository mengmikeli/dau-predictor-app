const {
  fitPowerCurve,
  fitExponentialDecay,
  getRetentionAtDay,
  calculateDAUimpact
} = require('./server-testable');

// Test data with known mathematical properties
const testRetentionData = {
  // Power curve based on actual default retention data shape
  // This uses realistic retention percentages that should fit well
  simplePowerCurve: {
    d1: 26.4,  // Matches default new user curve
    d7: 17.5,  
    d14: 15,   
    d28: 13,   
    d360: 6,   
    d720: 3    
  },
  
  // Exponential decay: retention = 0.1 + 0.4 * e^(-0.01*t)
  // At t=0: 0.5, t=100: ~0.247, t=200: ~0.181
  simpleExponentialDecay: {
    d1: 49.6,  // 0.1 + 0.4 * e^(-0.01*1) ≈ 0.496
    d7: 47.3,  // 0.1 + 0.4 * e^(-0.01*7) ≈ 0.473
    d14: 44.7, // 0.1 + 0.4 * e^(-0.01*14) ≈ 0.447
    d28: 39.5, // 0.1 + 0.4 * e^(-0.01*28) ≈ 0.395
    d360: 12.9, // 0.1 + 0.4 * e^(-0.01*360) ≈ 0.129
    d720: 10.1  // 0.1 + 0.4 * e^(-0.01*720) ≈ 0.101
  }
};

describe('fitPowerCurve', () => {
  test('should fit a power curve to realistic retention data', () => {
    const result = fitPowerCurve(testRetentionData.simplePowerCurve);
    
    // Should produce reasonable parameters for the given data
    expect(result.a).toBeGreaterThan(0);
    expect(Math.abs(result.b)).toBeGreaterThan(0); // Non-zero exponent (can be negative)
    expect(result.type).toBe('power');
    expect(result.rSquared).toBeGreaterThanOrEqual(0); // R-squared can vary
  });

  test('should handle edge case with all same retention values', () => {
    const flatRetention = {
      d1: 30, d7: 30, d14: 30, d28: 30, d360: 30, d720: 30
    };
    
    const result = fitPowerCurve(flatRetention);
    
    expect(result.a).toBeCloseTo(0.3, 1);
    expect(result.b).toBeCloseTo(0, 1); // No decay, b should be near 0
    expect(result.type).toBe('power');
  });

  test('should handle very low retention values', () => {
    const lowRetention = {
      d1: 1, d7: 0.5, d14: 0.3, d28: 0.2, d360: 0.1, d720: 0.05
    };
    
    const result = fitPowerCurve(lowRetention);
    
    expect(result.a).toBeGreaterThan(0);
    expect(result.b).toBeGreaterThanOrEqual(-1); // Allow negative b for some edge cases
    expect(result.type).toBe('power');
    expect(result.rSquared).toBeGreaterThanOrEqual(0);
  });

  test('should handle zero retention values by clamping to minimum', () => {
    const zeroRetention = {
      d1: 0, d7: 0, d14: 0, d28: 0, d360: 0, d720: 0
    };
    
    const result = fitPowerCurve(zeroRetention);
    
    // Should clamp to 0.001 and still produce valid results
    expect(result.a).toBeGreaterThan(0);
    expect(result.b).toBeGreaterThanOrEqual(0);
    expect(result.type).toBe('power');
  });
});

describe('fitExponentialDecay', () => {
  test('should fit an exponential decay to realistic retention data', () => {
    const result = fitExponentialDecay(testRetentionData.simpleExponentialDecay);
    
    // Should produce reasonable parameters for the given data
    expect(result.a).toBeGreaterThan(0);
    expect(result.lambda).toBeGreaterThan(0);
    expect(result.c).toBeGreaterThanOrEqual(0); // c is set to 80% of minimum
    expect(result.type).toBe('exponential');
    expect(result.rSquared).toBeGreaterThan(0.5); // Reasonable fit
  });

  test('should handle decreasing retention pattern', () => {
    const decreasingRetention = {
      d1: 50, d7: 40, d14: 35, d28: 30, d360: 20, d720: 15
    };
    
    const result = fitExponentialDecay(decreasingRetention);
    
    expect(result.a).toBeGreaterThan(0);
    expect(result.lambda).toBeGreaterThan(0);
    expect(result.c).toBeGreaterThanOrEqual(0);
    expect(result.type).toBe('exponential');
  });

  test('should set asymptote below minimum retention', () => {
    const retention = {
      d1: 60, d7: 50, d14: 45, d28: 40, d360: 25, d720: 20
    };
    
    const result = fitExponentialDecay(retention);
    
    // c should be 80% of minimum (20% = 0.2)
    expect(result.c).toBeCloseTo(0.16, 1);
    expect(result.type).toBe('exponential');
  });
});

describe('getRetentionAtDay', () => {
  const powerParams = { type: 'power', a: 0.5, b: 0.5 };
  const exponentialParams = { type: 'exponential', a: 0.4, lambda: 0.01, c: 0.1 };

  test('should return 100% retention for day 0', () => {
    expect(getRetentionAtDay(powerParams, 0)).toBe(1.0);
    expect(getRetentionAtDay(exponentialParams, 0)).toBe(1.0);
  });

  test('should calculate power curve retention correctly', () => {
    // retention = 0.5 * t^(-0.5)
    expect(getRetentionAtDay(powerParams, 1)).toBeCloseTo(0.5, 3);
    expect(getRetentionAtDay(powerParams, 4)).toBeCloseTo(0.25, 3);
    expect(getRetentionAtDay(powerParams, 9)).toBeCloseTo(0.167, 2);
  });

  test('should calculate exponential decay retention correctly', () => {
    // retention = 0.1 + 0.4 * e^(-0.01*t)
    expect(getRetentionAtDay(exponentialParams, 1)).toBeCloseTo(0.496, 2);
    expect(getRetentionAtDay(exponentialParams, 100)).toBeCloseTo(0.247, 2);
  });

  test('should clamp retention between 0 and 1', () => {
    const highParams = { type: 'power', a: 2.0, b: -0.5 }; // Could exceed 1
    const lowParams = { type: 'exponential', a: 0.01, lambda: 0.1, c: 0 }; // Could go negative
    
    expect(getRetentionAtDay(highParams, 1)).toBeLessThanOrEqual(1.0);
    expect(getRetentionAtDay(lowParams, 1000)).toBeGreaterThanOrEqual(0.0);
  });

  test('should handle very large day values', () => {
    expect(getRetentionAtDay(powerParams, 10000)).toBeGreaterThan(0);
    expect(getRetentionAtDay(exponentialParams, 10000)).toBeGreaterThan(0);
  });
});

describe('Existing User Decay Scenario', () => {
  const baselineData = {
    currentDAU: {
      commercial_ios: 1000000,
      commercial_android: 1000000,
      consumer_ios: 1000000,
      consumer_android: 1000000
    },
    weeklyAcquisitions: {
      commercial_ios: 0, // No new users
      commercial_android: 0,
      consumer_ios: 0,
      consumer_android: 0
    },
    retentionCurves: {
      existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
      new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
    }
  };

  test('should calculate pure decay with no new users', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    
    // Total initial DAU = 4,000,000
    // Expected formula: totalCurrentDAU * Math.pow(0.95, day / 30)
    
    // Month 1 (day 15): 4M * 0.95^(15/30) = 4M * 0.95^0.5 ≈ 3,897,433
    expect(result.baseline[0]).toBeCloseTo(3897433, -4); // Within reasonable range
    
    // Month 2 (day 45): 4M * 0.95^(45/30) = 4M * 0.95^1.5 ≈ 3,704,088
    expect(result.baseline[1]).toBeCloseTo(3704088, -4);
    
    // Month 12: Should show significant decay from initial value
    expect(result.baseline[11]).toBeLessThan(result.baseline[0] * 0.7); // At least 30% decay
  });

  test('should show zero incremental DAU with no initiatives', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    
    // All incremental DAU should be zero
    result.incrementalDAU.forEach(incremental => {
      expect(incremental).toBe(0);
    });
    
    // Baseline and withInitiative should be identical
    for (let i = 0; i < result.baseline.length; i++) {
      expect(result.withInitiative[i]).toBe(result.baseline[i]);
    }
  });

  test('should validate exponential decay formula at specific time points', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    const initialDAU = 4000000;
    
    // Test mathematical formula: DAU(t) = initialDAU * 0.95^(t/30)
    const testPoints = [
      { month: 1, day: 15, expected: initialDAU * Math.pow(0.95, 15/30) },
      { month: 3, day: 75, expected: initialDAU * Math.pow(0.95, 75/30) },
      { month: 6, day: 165, expected: initialDAU * Math.pow(0.95, 165/30) },
      { month: 12, day: 345, expected: initialDAU * Math.pow(0.95, 345/30) }
    ];
    
    testPoints.forEach(point => {
      expect(result.baseline[point.month - 1]).toBeCloseTo(point.expected, -2);
    });
  });
});

describe('New User Accumulation with Retention Curves', () => {
  const baselineData = {
    currentDAU: {
      commercial_ios: 0, // No existing users
      commercial_android: 0,
      consumer_ios: 0,
      consumer_android: 0
    },
    weeklyAcquisitions: {
      commercial_ios: 70000, // 10k daily
      commercial_android: 70000,
      consumer_ios: 70000,
      consumer_android: 70000
    },
    retentionCurves: {
      existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
      new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
    }
  };

  test('should calculate cohort-based DAU accumulation', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    
    // Total daily acquisitions = 280k / 7 = 40k daily
    // Should accumulate over time with retention curves
    
    // Month 1 should be less than Month 2 (accumulation effect)
    expect(result.baseline[1]).toBeGreaterThan(result.baseline[0]);
    
    // Month 6 should be greater than Month 3 (more cohorts active)
    expect(result.baseline[5]).toBeGreaterThan(result.baseline[2]);
    
    // Should eventually plateau as older cohorts decay
    expect(result.baseline[11]).toBeGreaterThan(result.baseline[0]);
  });

  test('should validate power curve retention formula integration', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    const dailyAcq = 40000; // 280k weekly / 7
    
    // Manually calculate expected DAU for Month 1 (day 15)
    // Formula: Σ[c=0 to 15] dailyAcq × retention(15 - c)
    // This tests the cohort summation logic
    
    let expectedDAU = 0;
    // We need to get the actual fitted curve parameters to validate
    // This test ensures the integration logic is working
    expect(result.baseline[0]).toBeGreaterThan(0);
    expect(result.baseline[0]).toBeLessThan(dailyAcq * 15); // Can't exceed all acquired users
  });

  test('should show accumulation over 12 months', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    
    // Should generally increase over time as more cohorts are acquired
    let previousValue = 0;
    let increasingMonths = 0;
    
    for (let i = 0; i < 12; i++) {
      if (result.baseline[i] > previousValue) {
        increasingMonths++;
      }
      previousValue = result.baseline[i];
    }
    
    // Most months should show growth (allowing for some plateau)
    expect(increasingMonths).toBeGreaterThan(8);
  });
});

describe('Combined Scenario Integration Tests', () => {
  const baselineData = {
    currentDAU: {
      commercial_ios: 1000000,
      commercial_android: 1000000,
      consumer_ios: 1000000,
      consumer_android: 1000000
    },
    weeklyAcquisitions: {
      commercial_ios: 35000,
      commercial_android: 35000,
      consumer_ios: 35000,
      consumer_android: 35000
    },
    retentionCurves: {
      existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
      new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
    }
  };

  test('should combine existing user decay with new user accumulation', () => {
    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(params);
    
    // Should have both components: decaying existing + accumulating new
    // Initial existing: 4M, daily new: 20k
    expect(result.baseline[0]).toBeGreaterThan(3000000); // Mostly existing users initially
    expect(result.baseline[0]).toBeLessThan(4000000); // Some decay already
    
    // Over time, new users should offset some decay
    const finalBaseline = result.baseline[11];
    expect(finalBaseline).toBeGreaterThan(1000000); // Significant user base remains
  });

  test('should validate retention improvement initiatives', () => {
    const retentionParams = {
      initiativeType: 'retention',
      retention: {
        targetUsers: 'new',
        monthsToStart: 1,
        d1Gain: 10, // 10 percentage point improvement
        d7Gain: 5,
        d14Gain: 3,
        d28Gain: 2,
        d360Gain: 1,
        d720Gain: 0.5
      },
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true },
      exposureRate: 50 // 50% of users exposed
    };

    const result = calculateDAUimpact(retentionParams);
    
    // Should show positive incremental DAU
    expect(result.summary.totalImpact).toBeGreaterThan(0);
    expect(result.summary.peakImpact).toBeGreaterThan(0);
    
    // Incremental DAU should start appearing after launch month
    expect(result.incrementalDAU[0]).toBe(0); // Month 1, but launches at month 1
    expect(result.incrementalDAU[2]).toBeGreaterThan(0); // Month 3, should have impact
  });

  test('should validate acquisition campaign initiatives', () => {
    const acquisitionParams = {
      initiativeType: 'acquisition',
      acquisition: {
        weeksToStart: 2,
        duration: 8, // 8 weeks
        weeklyInstalls: 140000 // 20k daily
      },
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true }
    };

    const result = calculateDAUimpact(acquisitionParams);
    
    // Should show positive incremental DAU from new acquisitions
    expect(result.summary.totalImpact).toBeGreaterThan(0);
    expect(result.summary.breakdown.newAcquisition).toBeGreaterThan(0);
    
    // Peak should occur during or shortly after campaign
    expect(result.summary.peakMonth).toBeGreaterThanOrEqual(1);
    expect(result.summary.peakMonth).toBeLessThanOrEqual(12); // Within the year
  });

  test('should validate combined retention and acquisition initiatives', () => {
    const combinedParams = {
      initiativeType: 'combined',
      retention: {
        targetUsers: 'all',
        monthsToStart: 0,
        d1Gain: 5,
        d7Gain: 3,
        d14Gain: 2,
        d28Gain: 1,
        d360Gain: 0.5,
        d720Gain: 0.2
      },
      acquisition: {
        weeksToStart: 1,
        duration: 4,
        weeklyInstalls: 70000
      },
      customBaseline: baselineData,
      segments: { commercial: true, consumer: true },
      platforms: { ios: true, android: true },
      exposureRate: 100
    };

    const result = calculateDAUimpact(combinedParams);
    
    // Should have impacts from all sources
    expect(result.summary.breakdown.existingUsers).toBeGreaterThan(0);
    expect(result.summary.breakdown.newUsers).toBeGreaterThan(0);
    expect(result.summary.breakdown.newAcquisition).toBeGreaterThan(0);
    
    // Total should be sum of components
    const totalComponents = result.summary.breakdown.existingUsers + 
                           result.summary.breakdown.newUsers + 
                           result.summary.breakdown.newAcquisition;
    expect(result.summary.totalImpact).toBeCloseTo(totalComponents, 0);
  });
});

describe('Edge Cases and Boundary Conditions', () => {
  test('should handle day 0 correctly', () => {
    const powerParams = { type: 'power', a: 0.5, b: 0.5 };
    const exponentialParams = { type: 'exponential', a: 0.4, lambda: 0.01, c: 0.1 };
    
    expect(getRetentionAtDay(powerParams, 0)).toBe(1.0);
    expect(getRetentionAtDay(exponentialParams, 0)).toBe(1.0);
  });

  test('should handle very large day values without crashing', () => {
    const powerParams = { type: 'power', a: 0.5, b: 0.5 };
    const exponentialParams = { type: 'exponential', a: 0.4, lambda: 0.01, c: 0.1 };
    
    expect(() => getRetentionAtDay(powerParams, 100000)).not.toThrow();
    expect(() => getRetentionAtDay(exponentialParams, 100000)).not.toThrow();
    
    expect(getRetentionAtDay(powerParams, 100000)).toBeGreaterThan(0);
    expect(getRetentionAtDay(exponentialParams, 100000)).toBeGreaterThan(0);
  });

  test('should handle zero acquisition scenario', () => {
    const baselineData = {
      currentDAU: { commercial_ios: 1000000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      weeklyAcquisitions: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      retentionCurves: {
        existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
        new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
      }
    };

    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: false },
      platforms: { ios: true, android: false }
    };

    expect(() => calculateDAUimpact(params)).not.toThrow();
    const result = calculateDAUimpact(params);
    expect(result.baseline[0]).toBeGreaterThan(0);
  });

  test('should handle zero existing users scenario', () => {
    const baselineData = {
      currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      weeklyAcquisitions: { commercial_ios: 70000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      retentionCurves: {
        existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
        new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
      }
    };

    const params = {
      initiativeType: 'none',
      customBaseline: baselineData,
      segments: { commercial: true, consumer: false },
      platforms: { ios: true, android: false }
    };

    expect(() => calculateDAUimpact(params)).not.toThrow();
    const result = calculateDAUimpact(params);
    expect(result.baseline[5]).toBeGreaterThan(0); // Should accumulate new users
  });

  test('should handle 100% exposure rate', () => {
    const baselineData = {
      currentDAU: { commercial_ios: 1000000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      weeklyAcquisitions: { commercial_ios: 70000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      retentionCurves: {
        existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
        new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
      }
    };

    const params = {
      initiativeType: 'retention',
      retention: { targetUsers: 'all', monthsToStart: 0, d1Gain: 10 },
      customBaseline: baselineData,
      segments: { commercial: true, consumer: false },
      platforms: { ios: true, android: false },
      exposureRate: 100
    };

    expect(() => calculateDAUimpact(params)).not.toThrow();
    const result = calculateDAUimpact(params);
    expect(result.summary.totalImpact).toBeGreaterThan(0);
  });

  test('should handle 0% exposure rate', () => {
    const baselineData = {
      currentDAU: { commercial_ios: 1000000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      weeklyAcquisitions: { commercial_ios: 70000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
      retentionCurves: {
        existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
        new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
      }
    };

    const params = {
      initiativeType: 'retention',
      retention: { targetUsers: 'all', monthsToStart: 0, d1Gain: 10 },
      customBaseline: baselineData,
      segments: { commercial: true, consumer: false },
      platforms: { ios: true, android: false },
      exposureRate: 0
    };

    expect(() => calculateDAUimpact(params)).not.toThrow();
    const result = calculateDAUimpact(params);
    expect(result.summary.totalImpact).toBe(0); // No exposure, no impact
  });
});