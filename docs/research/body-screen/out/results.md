# Body <-> Screen results

```json
{
  "H2": {
    "n_days": 50,
    "hrv_raw_vs_total_dynamism": {
      "n": 50,
      "pearson_r": -0.075,
      "pearson_p": 0.61,
      "spearman_rho": -0.11,
      "spearman_p": 0.45
    },
    "hrv_raw_vs_dyn_per_active_hour": {
      "n": 50,
      "pearson_r": -0.111,
      "pearson_p": 0.44,
      "spearman_rho": -0.099,
      "spearman_p": 0.49
    },
    "hrv_norm_vs_total_dynamism": {
      "n": 39,
      "pearson_r": -0.197,
      "pearson_p": 0.23,
      "spearman_rho": -0.18,
      "spearman_p": 0.27
    },
    "hrv_vs_weekly_vs_total": {
      "n": 48,
      "pearson_r": 0.02,
      "pearson_p": 0.89,
      "spearman_rho": -0.12,
      "spearman_p": 0.41
    },
    "ols_total~hrv+weekend": {
      "beta": -0.136,
      "p": 0.35,
      "r2": 0.079
    },
    "ols_total~hrv+weekend+sleep": {
      "n": 50,
      "beta": -0.09,
      "p": 0.62,
      "sleep": {
        "beta": -0.005,
        "p": 0.67
      },
      "r2": 0.082
    },
    "ols_rate~hrv+weekend+sleep": {
      "beta": -0.15,
      "p": 0.42,
      "r2": 0.017
    },
    "ols_total~hrv_norm+weekend": {
      "n": 39,
      "beta": -0.528,
      "p": 0.19
    },
    "placebo_next_night_hrv_vs_today_dynamism": {
      "n": 46,
      "pearson_r": -0.143,
      "pearson_p": 0.34,
      "spearman_rho": -0.063,
      "spearman_p": 0.68
    },
    "hrv_vs_daytime_stress": {
      "n": 49,
      "pearson_r": -0.029,
      "pearson_p": 0.85,
      "spearman_rho": -0.093,
      "spearman_p": 0.52
    }
  },
  "H1": {
    "n_hours": 333,
    "stress_vs_dyn_rate": {
      "n": 333,
      "pearson_r": 0.069,
      "pearson_p": 0.21,
      "spearman_rho": 0.025,
      "spearman_p": 0.65
    },
    "stress_vs_app_switches": {
      "n": 333,
      "pearson_r": 0.114,
      "pearson_p": 0.037,
      "spearman_rho": 0.125,
      "spearman_p": 0.022
    },
    "stress_vs_tab_switches": {
      "n": 333,
      "pearson_r": -0.167,
      "pearson_p": 0.0023,
      "spearman_rho": -0.177,
      "spearman_p": 0.0012
    },
    "stress_vs_move_rate": {
      "n": 311,
      "pearson_r": 0.005,
      "pearson_p": 0.93,
      "spearman_rho": -0.03,
      "spearman_p": 0.6
    },
    "partial_hour_dow": {
      "n": 333,
      "pearson_r": 0.03,
      "pearson_p": 0.59,
      "spearman_rho": -0.023,
      "spearman_p": 0.67
    },
    "ols_hac_stress_per_switch_per_min": {
      "beta": 0.245,
      "p": 0.64
    },
    "cross_correlation_same_day": {
      "stress(t-2) vs dyn_rate(t)": {
        "n": 176,
        "pearson_r": 0.083,
        "pearson_p": 0.27,
        "spearman_rho": 0.095,
        "spearman_p": 0.21
      },
      "stress(t-1) vs dyn_rate(t)": {
        "n": 215,
        "pearson_r": 0.062,
        "pearson_p": 0.36,
        "spearman_rho": 0.034,
        "spearman_p": 0.62
      },
      "stress(t+0) vs dyn_rate(t)": {
        "n": 333,
        "pearson_r": 0.069,
        "pearson_p": 0.21,
        "spearman_rho": 0.025,
        "spearman_p": 0.65
      },
      "stress(t+1) vs dyn_rate(t)": {
        "n": 215,
        "pearson_r": 0.111,
        "pearson_p": 0.1,
        "spearman_rho": 0.075,
        "spearman_p": 0.27
      },
      "stress(t+2) vs dyn_rate(t)": {
        "n": 176,
        "pearson_r": 0.057,
        "pearson_p": 0.45,
        "spearman_rho": 0.068,
        "spearman_p": 0.37
      }
    }
  },
  "H1_granger": {
    "lag1": {
      "stress->dyn_rate": {
        "n": 215,
        "F": 0.14,
        "p": 0.71
      },
      "dyn_rate->stress": {
        "n": 215,
        "F": 0.75,
        "p": 0.39
      }
    },
    "lag2": {
      "stress->dyn_rate": {
        "n": 148,
        "F": 0.47,
        "p": 0.63
      },
      "dyn_rate->stress": {
        "n": 148,
        "F": 0.26,
        "p": 0.77
      }
    },
    "lag3": {
      "stress->dyn_rate": {
        "n": 104,
        "F": 1.72,
        "p": 0.17
      },
      "dyn_rate->stress": {
        "n": 104,
        "F": 0.33,
        "p": 0.81
      }
    }
  },
  "H3": {
    "n_5min_bins": 2565,
    "entropy_vs_stress": {
      "n": 2565,
      "pearson_r": 0.012,
      "pearson_p": 0.56,
      "spearman_rho": 0.043,
      "spearman_p": 0.029
    },
    "partial_spearman_ctrl_total_input": {
      "rho": 0.059
    },
    "total_input_vs_stress": {
      "n": 2565,
      "pearson_r": -0.041,
      "pearson_p": 0.039,
      "spearman_rho": -0.036,
      "spearman_p": 0.066
    },
    "entropy_vs_total_input": {
      "n": 2565,
      "pearson_r": 0.249,
      "pearson_p": 1.6e-37,
      "spearman_rho": 0.336,
      "spearman_p": 6.6e-69
    }
  },
  "H4": {
    "n_hours": 333,
    "bb_delta_vs_dyn_rate": {
      "n": 333,
      "pearson_r": -0.194,
      "pearson_p": 0.00037,
      "spearman_rho": -0.147,
      "spearman_p": 0.0072
    },
    "partial_hour_dow": {
      "n": 333,
      "pearson_r": -0.017,
      "pearson_p": 0.75,
      "spearman_rho": 0.03,
      "spearman_p": 0.59
    },
    "partial_hour_dow_stress": {
      "n": 333,
      "pearson_r": 0.004,
      "pearson_p": 0.94,
      "spearman_rho": 0.003,
      "spearman_p": 0.96
    },
    "bb_delta_vs_stress": {
      "n": 333,
      "pearson_r": -0.616,
      "pearson_p": 3.6e-36,
      "spearman_rho": -0.612,
      "spearman_p": 1.2e-35
    }
  },
  "H5": {
    "tabs_touched": {
      "beta_std": {
        "z_tabs_touched": -3.785
      },
      "p": {
        "z_tabs_touched": 4.6e-06
      },
      "r2": 0.1654,
      "aic": 2862.5
    },
    "domains": {
      "beta_std": {
        "z_domains": -3.437
      },
      "p": {
        "z_domains": 0.00024
      },
      "r2": 0.1585,
      "aic": 2865.3
    },
    "tab_switches": {
      "beta_std": {
        "z_tab_switches": -4.031
      },
      "p": {
        "z_tab_switches": 1.4e-07
      },
      "r2": 0.1713,
      "aic": 2860.2
    },
    "app_switches": {
      "beta_std": {
        "z_app_switches": 1.207
      },
      "p": {
        "z_app_switches": 0.27
      },
      "r2": 0.1295,
      "aic": 2876.5
    },
    "dyn_rate": {
      "beta_std": {
        "z_dyn_rate": 0.561
      },
      "p": {
        "z_dyn_rate": 0.64
      },
      "r2": 0.1268,
      "aic": 2877.6
    },
    "both": {
      "beta_std": {
        "z_tabs_touched": -1.237,
        "z_tab_switches": -2.99
      },
      "p": {
        "z_tabs_touched": 0.46,
        "z_tab_switches": 0.057
      },
      "r2": 0.1725,
      "aic": 2861.7
    },
    "controls_only_r2": 0.126
  },
  "H6": {
    "per_phase": {
      "AFTERNOON": {
        "n": 174,
        "pearson_r": -0.029,
        "pearson_p": 0.7,
        "spearman_rho": -0.051,
        "spearman_p": 0.5,
        "stress_mean": 44.9,
        "dyn_rate_mean": 2.64
      },
      "EVENING": {
        "n": 76,
        "pearson_r": -0.108,
        "pearson_p": 0.35,
        "spearman_rho": -0.08,
        "spearman_p": 0.49,
        "stress_mean": 43.5,
        "dyn_rate_mean": 1.42
      },
      "MORNING": {
        "n": 78,
        "pearson_r": 0.263,
        "pearson_p": 0.02,
        "spearman_rho": 0.206,
        "spearman_p": 0.071,
        "stress_mean": 42.8,
        "dyn_rate_mean": 3.39
      }
    },
    "interaction_F": 2.7,
    "interaction_p": 0.069,
    "slopes": {
      "dyn_rate": -0.234,
      "dyn_rate:C(phase)[T.EVENING]": -1.591,
      "dyn_rate:C(phase)[T.MORNING]": 1.828,
      "dyn_rate:C(phase)[T.NIGHT]": 0.0
    }
  },
  "H1_robustness_loose_filters": {
    "n_hours": 368,
    "stress_vs_dyn_rate": {
      "n": 368,
      "pearson_r": 0.089,
      "pearson_p": 0.088,
      "spearman_rho": -0.005,
      "spearman_p": 0.92
    },
    "stress_vs_app_switches": {
      "n": 368,
      "pearson_r": 0.089,
      "pearson_p": 0.087,
      "spearman_rho": 0.075,
      "spearman_p": 0.15
    },
    "stress_vs_tab_switches": {
      "n": 368,
      "pearson_r": -0.195,
      "pearson_p": 0.00017,
      "spearman_rho": -0.219,
      "spearman_p": 2.3e-05
    }
  },
  "_coverage": {
    "digital_days": 78,
    "bio_days": 75,
    "hours_analysed_H1": 333,
    "days_H2": 50,
    "fivemin_bins_H3": 2565,
    "first_bio": "2026-06-25",
    "last": "2026-09-08",
    "bonferroni_alpha_6": 0.0083
  }
}
```
