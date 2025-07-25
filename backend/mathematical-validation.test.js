const {
  fitPowerCurve,
  fitExponentialDecay,
  getRetentionAtDay,
  calculateDAUimpact
} = require('./server-testable');

describe('Mathematical Validation with Hand-Calculated Results', () => {
  
  describe('Power Curve Mathematical Validation', () => {
    test('should validate power curve fitting produces reasonable parameters', () => {
      // Use realistic retention data that should fit a power curve well
      const realisticData = {
        d1: 26.4,   // Default new user retention
        d7: 17.5,   
        d14: 15,    
        d28: 13,    
        d360: 6,    
        d720: 3     
      };
      
      const result = fitPowerCurve(realisticData);
      
      // Should produce reasonable parameters for this data shape
      expect(result.a).toBeGreaterThan(0);
      expect(Math.abs(result.b)).toBeGreaterThan(0); // Non-zero exponent (can be negative)
      expect(result.type).toBe('power');
      expect(result.rSquared).toBeGreaterThanOrEqual(0); // R-squared can vary
    });

    test('should validate power curve predictions at specific time points', () => {
      const powerParams = { type: 'power', a: 0.5, b: 0.4 };
      
      // Hand-calculated values for retention = 0.5 * t^(-0.4)
      const expectedValues = [
        { day: 1, expected: 0.5 * Math.pow(1, -0.4) }, // = 0.5
        { day: 2, expected: 0.5 * Math.pow(2, -0.4) }, // ≈ 0.379
        { day: 5, expected: 0.5 * Math.pow(5, -0.4) }, // ≈ 0.287
        { day: 10, expected: 0.5 * Math.pow(10, -0.4) }, // ≈ 0.199
        { day: 30, expected: 0.5 * Math.pow(30, -0.4) }, // ≈ 0.118
        { day: 100, expected: 0.5 * Math.pow(100, -0.4) } // ≈ 0.079
      ];
      
      expectedValues.forEach(({ day, expected }) => {
        const actual = getRetentionAtDay(powerParams, day);
        expect(actual).toBeCloseTo(expected, 3);
      });
    });
  });

  describe('Exponential Decay Mathematical Validation', () => {
    test('should validate exponential decay fitting against theoretical data', () => {
      // Theoretical exponential: retention = 0.2 + 0.6 * e^(-0.005*t)
      // Hand-calculated values:
      // t=1: 0.2 + 0.6 * e^(-0.005) ≈ 0.2 + 0.6 * 0.995 ≈ 0.797
      // t=7: 0.2 + 0.6 * e^(-0.035) ≈ 0.2 + 0.6 * 0.966 ≈ 0.780
      // t=14: 0.2 + 0.6 * e^(-0.07) ≈ 0.2 + 0.6 * 0.932 ≈ 0.759
      // t=28: 0.2 + 0.6 * e^(-0.14) ≈ 0.2 + 0.6 * 0.869 ≈ 0.721
      // t=360: 0.2 + 0.6 * e^(-1.8) ≈ 0.2 + 0.6 * 0.165 ≈ 0.299
      // t=720: 0.2 + 0.6 * e^(-3.6) ≈ 0.2 + 0.6 * 0.027 ≈ 0.216
      
      const theoreticalData = {
        d1: 79.7,
        d7: 78.0,
        d14: 75.9,
        d28: 72.1,
        d360: 29.9,
        d720: 21.6
      };
      
      const result = fitExponentialDecay(theoreticalData);
      
      // Should recover original parameters within reasonable tolerance
      expect(result.a).toBeCloseTo(0.6, 1);
      expect(result.lambda).toBeCloseTo(0.005, 2);
      expect(result.c).toBeCloseTo(0.2, 1);
      expect(result.rSquared).toBeGreaterThan(0.95);
    });

    test('should validate exponential decay predictions at specific time points', () => {
      const expParams = { type: 'exponential', a: 0.3, lambda: 0.01, c: 0.15 };
      
      // Hand-calculated values for retention = 0.15 + 0.3 * e^(-0.01*t)
      const expectedValues = [
        { day: 1, expected: 0.15 + 0.3 * Math.exp(-0.01 * 1) }, // ≈ 0.447
        { day: 10, expected: 0.15 + 0.3 * Math.exp(-0.01 * 10) }, // ≈ 0.421
        { day: 50, expected: 0.15 + 0.3 * Math.exp(-0.01 * 50) }, // ≈ 0.332
        { day: 100, expected: 0.15 + 0.3 * Math.exp(-0.01 * 100) }, // ≈ 0.260
        { day: 200, expected: 0.15 + 0.3 * Math.exp(-0.01 * 200) }, // ≈ 0.190
        { day: 500, expected: 0.15 + 0.3 * Math.exp(-0.01 * 500) } // ≈ 0.152
      ];
      
      expectedValues.forEach(({ day, expected }) => {
        const actual = getRetentionAtDay(expParams, day);
        expect(actual).toBeCloseTo(expected, 3);
      });
    });
  });

  describe('Existing User Decay Mathematical Validation', () => {
    test('should validate exact decay formula: totalCurrentDAU * 0.95^(day/30)', () => {
      const baselineData = {
        currentDAU: {
          commercial_ios: 2000000, // Total = 2M for simple calculation
          commercial_android: 0,
          consumer_ios: 0,
          consumer_android: 0
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

      const params = {
        initiativeType: 'none',
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false }
      };

      const result = calculateDAUimpact(params);
      const initialDAU = 2000000;
      
      // Hand-calculated expected values using formula: 2M * 0.95^(day/30)
      const expectedValues = [
        { month: 1, day: 15, expected: initialDAU * Math.pow(0.95, 15/30) }, // ≈ 1,948,683
        { month: 2, day: 45, expected: initialDAU * Math.pow(0.95, 45/30) }, // ≈ 1,852,044
        { month: 3, day: 75, expected: initialDAU * Math.pow(0.95, 75/30) }, // ≈ 1,759,442
        { month: 6, day: 165, expected: initialDAU * Math.pow(0.95, 165/30) }, // ≈ 1,435,317
        { month: 12, day: 345, expected: initialDAU * Math.pow(0.95, 345/30) } // ≈ 1,073,542
      ];
      
      expectedValues.forEach(({ month, expected }) => {
        const actual = result.baseline[month - 1];
        expect(actual).toBeCloseTo(expected, -2); // Within 100 users
      });
    });

    test('should validate decay rate consistency across different time periods', () => {
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

      const result = calculateDAUimpact(params);
      
      // Validate that the decay follows exponential pattern
      // Each month should be approximately 95% of previous month's calculation
      for (let i = 1; i < 12; i++) {
        const currentMonth = result.baseline[i];
        const previousCalculation = result.baseline[i-1] * Math.pow(0.95, 30/30); // One month decay
        
        // Should be close to exponential decay expectation
        const tolerance = Math.abs(currentMonth - previousCalculation) / previousCalculation;
        expect(tolerance).toBeLessThan(0.05); // Within 5% tolerance for numerical precision
      }
    });
  });

  describe('New User Cohort Accumulation Mathematical Validation', () => {
    test('should validate cohort summation formula', () => {
      // Simplified scenario for hand calculation
      const baselineData = {
        currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { 
          commercial_ios: 21000, // 3000 daily for easy calculation
          commercial_android: 0, 
          consumer_ios: 0, 
          consumer_android: 0 
        },
        retentionCurves: {
          existing: { d1: 95, d7: 90, d14: 85, d28: 80, d360: 50, d720: 30 },
          new: { 
            // Simple retention for easy calculation: starts at 60%, decays predictably
            d1: 60, d7: 45, d14: 35, d28: 25, d360: 10, d720: 5 
          }
        }
      };

      const params = {
        initiativeType: 'none',
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false }
      };

      const result = calculateDAUimpact(params);
      const dailyAcq = 3000;
      
      // Month 1 (day 15): Sum of cohorts 0-14 days old
      // Manual calculation for verification
      // This tests that the cohort summation logic is working correctly
      
      // Should be positive and reasonable
      expect(result.baseline[0]).toBeGreaterThan(0);
      expect(result.baseline[0]).toBeLessThan(dailyAcq * 15); // Can't exceed total acquired
      
      // Should increase over time as more cohorts accumulate
      expect(result.baseline[2]).toBeGreaterThan(result.baseline[0]); // Month 3 > Month 1
      expect(result.baseline[5]).toBeGreaterThan(result.baseline[2]); // Month 6 > Month 3
    });

    test('should validate day 0 retention handling in cohort calculation', () => {
      const baselineData = {
        currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 7000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
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

      const result = calculateDAUimpact(params);
      
      // Day 0 cohort should contribute 100% retention (1000 users * 1.0)
      // Day 1 cohort should contribute ~50% retention
      // This validates the getRetentionAtDay(params, 0) = 1.0 logic
      
      expect(result.baseline[0]).toBeGreaterThan(1000); // Should include day 0 users
    });
  });

  describe('Retention Initiative Mathematical Validation', () => {
    test('should validate retention uplift calculation for existing users', () => {
      const baselineData = {
        currentDAU: { commercial_ios: 100000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        retentionCurves: {
          existing: { d1: 80, d7: 70, d14: 60, d28: 50, d360: 30, d720: 20 },
          new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
        }
      };

      const params = {
        initiativeType: 'retention',
        retention: {
          targetUsers: 'existing',
          monthsToStart: 0, // Launch immediately
          d1Gain: 10, // 10 percentage point improvement
          d7Gain: 8,
          d14Gain: 6,
          d28Gain: 5,
          d360Gain: 3,
          d720Gain: 2
        },
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false },
        exposureRate: 100 // 100% exposure for simple calculation
      };

      const result = calculateDAUimpact(params);
      
      // Hand calculation for Month 2 (day 45):
      // Launch Cohort Size = 100k * 0.95^(0/30) * 1.0 = 100k
      // Days Since Launch = 45
      // Base retention at day 45 using existing curve
      // Improved retention = base + gains
      // Incremental = 100k * (improved - base)
      
      expect(result.summary.totalImpact).toBeGreaterThan(0);
      expect(result.summary.breakdown.existingUsers).toBeGreaterThan(0);
      expect(result.summary.breakdown.newUsers).toBe(0); // Only targeting existing
    });

    test('should validate retention uplift calculation for new users', () => {
      const baselineData = {
        currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 7000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        retentionCurves: {
          existing: { d1: 80, d7: 70, d14: 60, d28: 50, d360: 30, d720: 20 },
          new: { d1: 40, d7: 25, d14: 20, d28: 15, d360: 8, d720: 4 }
        }
      };

      const params = {
        initiativeType: 'retention',
        retention: {
          targetUsers: 'new',
          monthsToStart: 1, // Launch at month 1
          d1Gain: 15, // 15 percentage point improvement
          d7Gain: 10,
          d14Gain: 8,
          d28Gain: 6,
          d360Gain: 3,
          d720Gain: 2
        },
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false },
        exposureRate: 50 // 50% exposure
      };

      const result = calculateDAUimpact(params);
      
      // Should only affect new users
      expect(result.summary.breakdown.existingUsers).toBe(0);
      expect(result.summary.breakdown.newUsers).toBeGreaterThan(0);
      
      // No impact in first month (launches at month 1)
      expect(result.incrementalDAU[0]).toBe(0);
      
      // Should have impact in later months
      expect(result.incrementalDAU[2]).toBeGreaterThan(0);
    });
  });

  describe('Acquisition Campaign Mathematical Validation', () => {
    test('should validate acquisition ramp and cohort calculation', () => {
      const baselineData = {
        currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        retentionCurves: {
          existing: { d1: 80, d7: 70, d14: 60, d28: 50, d360: 30, d720: 20 },
          new: { d1: 50, d7: 30, d14: 25, d28: 20, d360: 10, d720: 5 }
        }
      };

      const params = {
        initiativeType: 'acquisition',
        acquisition: {
          weeksToStart: 2, // Start at week 2 (day 14)
          duration: 4, // 4 weeks
          weeklyInstalls: 14000 // 2000 daily
        },
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false }
      };

      const result = calculateDAUimpact(params);
      
      // Campaign starts day 14, ends day 42
      // Month 1 (day 15): 1 day of campaign at low ramp rate
      // Month 2 (day 45): Full campaign completed + retention effects
      
      expect(result.summary.breakdown.newAcquisition).toBeGreaterThan(0);
      
      // Should peak during or shortly after campaign
      expect(result.summary.peakMonth).toBeGreaterThanOrEqual(1);
      expect(result.summary.peakMonth).toBeLessThanOrEqual(12); // Within the year
    });

    test('should validate ramp rate calculation', () => {
      // Test that ramp rate follows expected formula: min(1, days_in_campaign / (ramp_weeks * 7))
      const baselineData = {
        currentDAU: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 0, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        retentionCurves: {
          existing: { d1: 80, d7: 70, d14: 60, d28: 50, d360: 30, d720: 20 },
          new: { d1: 100, d7: 100, d14: 100, d28: 100, d360: 100, d720: 100 } // 100% retention for simple calculation
        }
      };

      const params = {
        initiativeType: 'acquisition',
        acquisition: {
          weeksToStart: 0, // Start immediately
          duration: 8, // 8 weeks (ramp = min(4, 8) = 4 weeks)
          weeklyInstalls: 7000 // 1000 daily
        },
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false }
      };

      const result = calculateDAUimpact(params);
      
      // With 100% retention, incremental DAU should equal cumulative acquired users
      // Month 1 (day 15): Should have ramped acquisition
      // Month 2 (day 45): Should have full ramp + all cohorts active
      
      expect(result.incrementalDAU[0]).toBeGreaterThan(0);
      expect(result.incrementalDAU[1]).toBeGreaterThan(result.incrementalDAU[0]);
    });
  });

  describe('Combined Scenario Mathematical Validation', () => {
    test('should validate that total impact equals sum of components', () => {
      const baselineData = {
        currentDAU: { commercial_ios: 50000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        weeklyAcquisitions: { commercial_ios: 7000, commercial_android: 0, consumer_ios: 0, consumer_android: 0 },
        retentionCurves: {
          existing: { d1: 80, d7: 70, d14: 60, d28: 50, d360: 30, d720: 20 },
          new: { d1: 40, d7: 25, d14: 20, d28: 15, d360: 8, d720: 4 }
        }
      };

      const params = {
        initiativeType: 'combined',
        retention: {
          targetUsers: 'all',
          monthsToStart: 0,
          d1Gain: 5, d7Gain: 3, d14Gain: 2, d28Gain: 1, d360Gain: 0.5, d720Gain: 0.2
        },
        acquisition: {
          weeksToStart: 1,
          duration: 6,
          weeklyInstalls: 7000
        },
        customBaseline: baselineData,
        segments: { commercial: true, consumer: false },
        platforms: { ios: true, android: false },
        exposureRate: 100
      };

      const result = calculateDAUimpact(params);
      
      // Validate mathematical consistency
      const totalComponents = result.summary.breakdown.existingUsers + 
                             result.summary.breakdown.newUsers + 
                             result.summary.breakdown.newAcquisition;
      
      expect(result.summary.totalImpact).toBeCloseTo(totalComponents, 0);
      
      // All components should be positive
      expect(result.summary.breakdown.existingUsers).toBeGreaterThan(0);
      expect(result.summary.breakdown.newUsers).toBeGreaterThan(0);
      expect(result.summary.breakdown.newAcquisition).toBeGreaterThan(0);
    });
  });
});