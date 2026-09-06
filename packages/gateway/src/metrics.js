/**
 * Metrics Collector:
 * Safe instrumentation for hosted recovery service monitoring.
 * Strictly avoids logging or storing any user source code, filenames, or payloads.
 */

class MetricsCollector {
  constructor() {
    this.counters = {
      jobs_submitted_total: 0,
      jobs_completed_total: 0,
      jobs_failed_total: 0,
      jobs_cancelled_total: 0,
      jobs_timed_out_total: 0,
      rate_limit_rejections_total: 0,
      admissions_l5w_total: 0,
      admissions_l4_total: 0,
      admissions_none_total: 0
    };

    this.timings = {
      durationsMs: []
    };
  }

  inc(counterName, amount = 1) {
    if (counterName in this.counters) {
      this.counters[counterName] += amount;
    }
  }

  recordJobDuration(durationMs) {
    if (typeof durationMs === 'number' && durationMs >= 0) {
      this.timings.durationsMs.push(durationMs);
      // Keep last 1000 observations to bound memory
      if (this.timings.durationsMs.length > 1000) {
        this.timings.durationsMs.shift();
      }
    }
  }

  recordAdmission(tier, isL5WEligible) {
    if (isL5WEligible || tier === 'L5-W') {
      this.inc('admissions_l5w_total');
    } else if (tier === 'L4') {
      this.inc('admissions_l4_total');
    } else {
      this.inc('admissions_none_total');
    }
  }

  getSnapshot() {
    const durations = this.timings.durationsMs;
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // Percentiles
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

    return {
      counters: { ...this.counters },
      timings: {
        samples: durations.length,
        avgDurationMs: Math.round(avgDuration * 100) / 100,
        p50DurationMs: p50,
        p95DurationMs: p95
      }
    };
  }

  reset() {
    for (const key of Object.keys(this.counters)) {
      this.counters[key] = 0;
    }
    this.timings.durationsMs = [];
  }
}

module.exports = {
  MetricsCollector
};
