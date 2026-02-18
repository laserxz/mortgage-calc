import { useState, useMemo, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Area,
  AreaChart,
} from "recharts";

/* ─── STAMP DUTY BY STATE (2024 rates) ─── */

// Progressive duty brackets: { from, base, rate }
// duty = base + (price - from) * rate  for the highest applicable bracket
const STATE_DUTY_BRACKETS = {
  NSW: [
    { from: 0,        base: 0,      rate: 0.0125 },
    { from: 16000,    base: 200,    rate: 0.015  },
    { from: 35000,    base: 485,    rate: 0.0175 },
    { from: 93000,    base: 1500,   rate: 0.035  },
    { from: 351000,   base: 10530,  rate: 0.045  },
    { from: 1168000,  base: 47295,  rate: 0.055  },
  ],
  VIC: [
    { from: 0,        base: 0,      rate: 0.014  },
    { from: 25000,    base: 350,    rate: 0.024  },
    { from: 130000,   base: 2870,   rate: 0.06   },
    { from: 960000,   base: 52670,  rate: 0.055  },
  ],
  QLD: [
    { from: 0,        base: 0,      rate: 0      },
    { from: 5000,     base: 0,      rate: 0.015  },
    { from: 75000,    base: 1050,   rate: 0.035  },
    { from: 540000,   base: 17325,  rate: 0.045  },
    { from: 1000000,  base: 38025,  rate: 0.0575 },
  ],
  SA: [
    { from: 0,        base: 0,      rate: 0.01   },
    { from: 12000,    base: 120,    rate: 0.02   },
    { from: 30000,    base: 480,    rate: 0.03   },
    { from: 50000,    base: 1080,   rate: 0.035  },
    { from: 100000,   base: 2830,   rate: 0.04   },
    { from: 200000,   base: 6830,   rate: 0.0425 },
    { from: 250000,   base: 8955,   rate: 0.0475 },
    { from: 300000,   base: 11330,  rate: 0.05   },
    { from: 500000,   base: 21330,  rate: 0.055  },
  ],
  WA: [
    { from: 0,        base: 0,      rate: 0.019  },
    { from: 80000,    base: 1520,   rate: 0.0285 },
    { from: 100000,   base: 2090,   rate: 0.038  },
    { from: 250000,   base: 7790,   rate: 0.0475 },
    { from: 500000,   base: 19665,  rate: 0.0515 },
  ],
  TAS: [
    { from: 0,        base: 20,     rate: 0      },
    { from: 3000,     base: 75,     rate: 0.03   },
    { from: 25000,    base: 735,    rate: 0.035  },
    { from: 75000,    base: 2485,   rate: 0.04   },
    { from: 200000,   base: 7485,   rate: 0.045  },
    { from: 375000,   base: 15360,  rate: 0.045  },
  ],
  ACT: [
    { from: 0,        base: 0,      rate: 0.0032 },
    { from: 200000,   base: 640,    rate: 0.022  },
    { from: 300000,   base: 2840,   rate: 0.034  },
    { from: 500000,   base: 9640,   rate: 0.0432 },
    { from: 750000,   base: 20440,  rate: 0.059  },
    { from: 1000000,  base: 35190,  rate: 0.064  },
  ],
};

// First home buyer: { exempt (fully exempt ≤ this), ceiling (sliding concession ends) }
// States with no duty concession (grants instead) use exempt: 0
const FIRST_HOME_EXEMPTIONS = {
  NSW: { exempt: 800000,  ceiling: 1000000 },
  VIC: { exempt: 600000,  ceiling: 750000  },
  QLD: { exempt: 550000,  ceiling: 700000  },
  SA:  { exempt: 650000,  ceiling: 700000  },
  WA:  { exempt: 430000,  ceiling: 530000  },
  TAS: { exempt: 0,       ceiling: 0       }, // first home grant, not duty concession
  ACT: { exempt: 0,       ceiling: 0       }, // income-tested concession, simplified away
  NT:  { exempt: 0,       ceiling: 0       }, // no duty exemption
};

// NT uses a formula-based approach rather than progressive brackets
const calcNTDuty = (price) => {
  if (price <= 525000) {
    const V = price / 1000;
    return Math.round(0.06571441 * V * V + 15 * V);
  }
  return Math.round(price * 0.0495);
};

const calcProgressiveDuty = (price, brackets) => {
  for (let i = brackets.length - 1; i >= 0; i--) {
    if (price >= brackets[i].from) {
      return Math.round(brackets[i].base + (price - brackets[i].from) * brackets[i].rate);
    }
  }
  return 0;
};

const calcFullDuty = (price, state) => {
  if (state === "NT") return calcNTDuty(price);
  const brackets = STATE_DUTY_BRACKETS[state];
  if (!brackets) return 0;
  return calcProgressiveDuty(price, brackets);
};

const calculateStampDuty = (price, state = "NSW", isFirstHome = false) => {
  const exemption = FIRST_HOME_EXEMPTIONS[state];
  if (isFirstHome && exemption && exemption.exempt > 0) {
    if (price <= exemption.exempt) return 0;
    if (price <= exemption.ceiling) {
      const fullDuty = calcFullDuty(price, state);
      const fraction = (price - exemption.exempt) / (exemption.ceiling - exemption.exempt);
      return Math.round(fullDuty * fraction);
    }
  }
  return calcFullDuty(price, state);
};

const STATE_NAMES = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  SA:  "South Australia",
  WA:  "Western Australia",
  TAS: "Tasmania",
  ACT: "ACT",
  NT:  "Northern Territory",
};

const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];

/* ─── LMI LOOKUP TABLE (approx, by LVR band & loan bucket) ─── */
const LMI_TABLE = {
  // LVR range: rate multiplied by loan amount
  81: 0.008,
  82: 0.0095,
  83: 0.011,
  84: 0.0125,
  85: 0.0155,
  86: 0.018,
  87: 0.021,
  88: 0.0245,
  89: 0.028,
  90: 0.032,
  91: 0.038,
  92: 0.042,
  93: 0.048,
  94: 0.054,
  95: 0.062,
};

const calculateLMI = (loanAmount, lvr) => {
  if (lvr <= 80) return 0;
  const band = Math.min(Math.ceil(lvr), 95);
  const rate = LMI_TABLE[band] || 0.062;
  // Higher loans attract premium loading
  let loading = 1.0;
  if (loanAmount > 750000) loading = 1.15;
  if (loanAmount > 1000000) loading = 1.3;
  return Math.round(loanAmount * rate * loading);
};

/* ─── CORE PAYMENT FORMULA ─── */
const calcPayment = (principal, annualRate, years) => {
  if (principal <= 0 || annualRate <= 0 || years <= 0) return 0;
  const r = annualRate / 12 / 100;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
};

/* ─── AMORTIZATION SCHEDULE ─── */
const buildAmortization = (principal, annualRate, years, extraMonthly = 0, offset = 0) => {
  const r = annualRate / 12 / 100;
  const n = years * 12;
  const basePayment = calcPayment(principal, annualRate, years);
  const schedule = [];
  let balance = principal;

  for (let month = 1; month <= n && balance > 0; month++) {
    const effectiveBalance = Math.max(balance - offset, 0);
    const interestPay = effectiveBalance * r;
    const totalPay = Math.min(basePayment + extraMonthly, balance + interestPay);
    const principalPay = totalPay - interestPay;
    balance = Math.max(balance - principalPay, 0);

    schedule.push({
      month,
      year: Math.ceil(month / 12),
      principalPay: Math.round(principalPay),
      interestPay: Math.round(interestPay),
      balance: Math.round(balance),
      totalPaid: Math.round(totalPay),
    });

    if (balance <= 0) break;
  }
  return schedule;
};

/* ─── AFFORDABILITY ─── */
const calcMaxLoan = (annualIncome, monthlyExpenses, annualRate, years) => {
  const monthlyIncome = annualIncome / 12;
  const maxPayment = (monthlyIncome - monthlyExpenses) * 0.35;
  if (maxPayment <= 0 || annualRate <= 0) return 0;
  const r = annualRate / 12 / 100;
  const n = years * 12;
  return maxPayment * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
};

/* ─── FREQUENCY CONVERSION ─── */
const convertPayment = (monthlyPay, frequency) => {
  switch (frequency) {
    case "fortnightly":
      return (monthlyPay * 12) / 26;
    case "weekly":
      return (monthlyPay * 12) / 52;
    default:
      return monthlyPay;
  }
};

const frequencyLabel = (f) =>
  f === "fortnightly" ? "Fortnight" : f === "weekly" ? "Week" : "Month";

/* ─── FORMAT HELPERS ─── */
const fmt = (n) => {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${Math.round(n)}`;
};

const fmtShort = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n)}`;
};

/* ─── SLIDER COMPONENT ─── */
const Slider = ({ label, value, min, max, step, onChange, prefix = "$", suffix = "", formatDisplay }) => {
  const pct = ((value - min) / (max - min)) * 100;
  const display = formatDisplay ? formatDisplay(value) : prefix + Math.round(value).toLocaleString() + suffix;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium" style={{ color: "#7a8599" }}>
          {label}
        </label>
        <span className="text-lg font-semibold tabular-nums" style={{ color: "#e8eaed", fontFamily: "'DM Mono', monospace" }}>
          {display}
        </span>
      </div>
      <div className="relative h-8 flex items-center">
        <div className="absolute w-full h-1.5 rounded-full" style={{ background: "#2a3040" }} />
        <div
          className="absolute h-1.5 rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #3b82a0, #4ecdc4)",
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute w-full appearance-none bg-transparent cursor-pointer z-10"
          style={{ height: "40px" }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-xs" style={{ color: "#555e6e" }}>
          {prefix}{typeof min === 'number' && min >= 1000 ? Math.round(min).toLocaleString() : min}{suffix}
        </span>
        <span className="text-xs" style={{ color: "#555e6e" }}>
          {prefix}{typeof max === 'number' && max >= 1000 ? Math.round(max).toLocaleString() : max}{suffix}
        </span>
      </div>
    </div>
  );
};

/* ─── TOGGLE BUTTON GROUP ─── */
const ToggleGroup = ({ options, value, onChange, label }) => (
  <div className="space-y-2">
    {label && (
      <label className="text-sm font-medium" style={{ color: "#7a8599" }}>
        {label}
      </label>
    )}
    <div className="flex rounded-xl overflow-hidden" style={{ background: "#1c2230" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="flex-1 py-2.5 px-3 text-sm font-medium transition-all duration-200"
          style={{
            background: value === opt.value ? "linear-gradient(135deg, #3b82a0, #4ecdc4)" : "transparent",
            color: value === opt.value ? "#0f1520" : "#7a8599",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

/* ─── STAT CARD ─── */
const StatCard = ({ label, value, sub, accent }) => (
  <div
    className="rounded-xl p-3 space-y-0.5"
    style={{ background: "#1c2230", border: accent ? "1px solid #3b82a044" : "1px solid #2a303e" }}
  >
    <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "#6b7588" }}>
      {label}
    </div>
    <div
      className="text-xl font-bold tabular-nums"
      style={{
        color: accent ? "#4ecdc4" : "#e8eaed",
        fontFamily: "'DM Mono', monospace",
      }}
    >
      {value}
    </div>
    {sub && (
      <div className="text-xs" style={{ color: "#555e6e" }}>
        {sub}
      </div>
    )}
  </div>
);

/* ─── YEARLY CHART DATA ─── */
const buildYearlyData = (schedule) => {
  const yearly = [];
  let yearInterest = 0;
  let yearPrincipal = 0;

  for (const row of schedule) {
    yearInterest += row.interestPay;
    yearPrincipal += row.principalPay;
    if (row.month % 12 === 0 || row.month === schedule.length) {
      yearly.push({
        year: row.year,
        balance: row.balance,
        interest: yearInterest,
        principal: yearPrincipal,
      });
      yearInterest = 0;
      yearPrincipal = 0;
    }
  }
  return yearly;
};

/* ─── CUSTOM TOOLTIP ─── */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl p-3 text-sm shadow-xl"
      style={{ background: "#1c2230ee", border: "1px solid #2a303e" }}
    >
      <div className="font-medium mb-1" style={{ color: "#e8eaed" }}>
        Year {label}
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: "#7a8599" }}>{p.name}:</span>
          <span className="font-medium" style={{ color: "#e8eaed" }}>
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ─── PIE TOOLTIP ─── */
const PieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl p-3 text-sm shadow-xl"
      style={{ background: "#1c2230ee", border: "1px solid #2a303e" }}
    >
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: payload[0].payload.fill }} />
        <span style={{ color: "#7a8599" }}>{payload[0].name}:</span>
        <span className="font-medium" style={{ color: "#e8eaed" }}>
          {fmt(payload[0].value)}
        </span>
      </div>
    </div>
  );
};

/* ━━━ MAIN APP ━━━ */
export default function MortgageCalculator() {
  // ─── State ───
  const [tab, setTab] = useState("repayment");
  const [homePrice, setHomePrice] = useState(850000);
  const [depositPct, setDepositPct] = useState(20);
  const [rate, setRate] = useState(6.2);
  const [term, setTerm] = useState(30);
  const [frequency, setFrequency] = useState("monthly");
  const [extraRepay, setExtraRepay] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isFirstHome, setIsFirstHome] = useState(false);
  const [selectedState, setSelectedState] = useState("NSW");

  // Affordability
  const [income, setIncome] = useState(150000);
  const [expenses, setExpenses] = useState(2500);

  // ─── Derived ───
  const deposit = Math.round(homePrice * (depositPct / 100));
  const loanAmount = homePrice - deposit;
  const lvr = homePrice > 0 ? (loanAmount / homePrice) * 100 : 0;

  const results = useMemo(() => {
    const monthly = calcPayment(loanAmount - offset, rate, term);
    const schedule = buildAmortization(loanAmount, rate, term, extraRepay, offset);
    const totalPaid = schedule.reduce((s, r) => s + r.totalPaid, 0);
    const totalInterest = schedule.reduce((s, r) => s + r.interestPay, 0);
    const stampDuty = calculateStampDuty(homePrice, selectedState, isFirstHome);
    const lmi = calculateLMI(loanAmount, lvr);
    const actualMonths = schedule.length;
    const yearlyData = buildYearlyData(schedule);

    // Affordability
    const maxLoan = calcMaxLoan(income, expenses, rate, term);
    const maxPrice = maxLoan / (1 - depositPct / 100);

    return {
      monthly,
      schedule,
      totalPaid,
      totalInterest,
      stampDuty,
      lmi,
      actualMonths,
      yearlyData,
      maxLoan: Math.round(maxLoan),
      maxPrice: Math.round(maxPrice),
      maxMonthly: calcPayment(maxLoan, rate, term),
    };
  }, [homePrice, depositPct, rate, term, extraRepay, offset, isFirstHome, selectedState, income, expenses, loanAmount, lvr]);

  const displayPayment = convertPayment(results.monthly + extraRepay, frequency);
  const upfrontCosts = deposit + results.stampDuty + results.lmi;

  // Pie data
  const pieData = [
    { name: "Principal", value: loanAmount, fill: "#4ecdc4" },
    { name: "Interest", value: results.totalInterest, fill: "#f97066" },
    { name: "Stamp Duty", value: results.stampDuty, fill: "#fbbf24" },
    ...(results.lmi > 0 ? [{ name: "LMI", value: results.lmi, fill: "#a78bfa" }] : []),
  ];

  const affordPie = [
    { name: "Max Loan", value: results.maxLoan, fill: "#4ecdc4" },
    { name: "Deposit", value: Math.round(results.maxPrice * depositPct / 100), fill: "#3b82a0" },
  ];

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(170deg, #0f1520 0%, #141c2b 40%, #101824 100%)",
        color: "#e8eaed",
        fontFamily: "'DM Sans', -apple-system, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        
        input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; border-radius: 50%;
          background: linear-gradient(135deg, #4ecdc4, #3b82a0);
          box-shadow: 0 0 12px #4ecdc444, 0 2px 8px #0008;
          cursor: pointer; margin-top: -3px;
          transition: transform 0.15s ease;
        }
        input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.15); }
        input[type="range"]::-webkit-slider-thumb:active { transform: scale(1.05); }
        input[type="range"]::-moz-range-thumb {
          width: 22px; height: 22px; border: none; border-radius: 50%;
          background: linear-gradient(135deg, #4ecdc4, #3b82a0);
          box-shadow: 0 0 12px #4ecdc444, 0 2px 8px #0008;
          cursor: pointer;
        }
        input[type="range"]:focus { outline: none; }
        
        .card-glass {
          background: linear-gradient(135deg, #1a2235cc, #1e2a3ecc);
          border: 1px solid #2a3348;
          backdrop-filter: blur(20px);
          border-radius: 12px;
          padding: 16px;
        }
        
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up { animation: fadeUp 0.5s ease-out both; }
        .fade-up-d1 { animation-delay: 0.1s; }
        .fade-up-d2 { animation-delay: 0.2s; }
        .fade-up-d3 { animation-delay: 0.3s; }
        
        .glow-line {
          height: 2px;
          background: linear-gradient(90deg, transparent, #4ecdc466, #3b82a066, transparent);
        }
        
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a3348; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto" }}>

      {/* ── HEADER ── */}
      <header className="text-center pt-8 pb-4 fade-up" style={{ padding: "32px 15px 16px" }}>
        <div className="inline-flex items-center gap-2 mb-3 px-4 py-1 rounded-full text-xs font-medium" style={{ background: "#4ecdc415", color: "#4ecdc4", border: "1px solid #4ecdc433" }}>
          <span>🏠</span> Free · No sign-up · AU focused
        </div>
        <h1
          className="text-3xl md:text-4xl font-bold mb-2"
          style={{
            background: "linear-gradient(135deg, #e8eaed 30%, #4ecdc4 70%, #3b82a0)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            lineHeight: 1.2,
          }}
        >
          Mortgage Calculator
        </h1>
        <p className="text-sm max-w-lg mx-auto" style={{ color: "#6b7588" }}>
          Accurate {STATE_NAMES[selectedState]} estimates including stamp duty, LMI, and amortization.
        </p>
      </header>

      {/* ── TAB SWITCHER ── */}
      <div className="flex justify-center mb-5 fade-up fade-up-d1" style={{ padding: "0 15px" }}>
        <div className="flex gap-2 rounded-2xl p-1.5" style={{ background: "#1a2235", border: "1px solid #2a3348" }}>
          {[
            { id: "repayment", label: "Repayments" },
            { id: "affordability", label: "Affordability" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-8 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
              style={{
                background: tab === t.id ? "linear-gradient(135deg, #3b82a0, #4ecdc4)" : "transparent",
                color: tab === t.id ? "#0f1520" : "#6b7588",
                minWidth: 160,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── MAIN GRID ── */}
      <div className="pb-10" style={{ padding: "0 15px 40px" }}>
        <div className="grid lg:grid-cols-5 gap-5">
          {/* ─── LEFT: INPUTS (2 cols) ─── */}
          <div className="lg:col-span-2 space-y-4 fade-up fade-up-d1">
            <div className="card-glass space-y-4">
              {/* ─── State Selector ─── */}
              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: "#7a8599" }}>
                  State / Territory
                </label>
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full rounded-xl text-sm font-medium"
                  style={{
                    background: "#1c2230",
                    color: "#e8eaed",
                    border: "1px solid #2a3348",
                    padding: "10px 14px",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none",
                    WebkitAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%237a8599' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 12px center",
                    paddingRight: "32px",
                  }}
                >
                  {AU_STATES.map((s) => (
                    <option key={s} value={s} style={{ background: "#1c2230" }}>
                      {s} — {STATE_NAMES[s]}
                    </option>
                  ))}
                </select>
              </div>

              {tab === "repayment" ? (
                <>
                  <Slider
                    label="Home Price"
                    value={homePrice}
                    min={200000}
                    max={3000000}
                    step={10000}
                    onChange={setHomePrice}
                  />
                  <Slider
                    label="Deposit"
                    value={depositPct}
                    min={5}
                    max={50}
                    step={1}
                    onChange={setDepositPct}
                    prefix=""
                    suffix="%"
                    formatDisplay={(v) => `${v}% (${fmt(homePrice * v / 100)})`}
                  />
                  <Slider
                    label="Interest Rate"
                    value={rate}
                    min={2}
                    max={12}
                    step={0.1}
                    onChange={setRate}
                    prefix=""
                    suffix="% p.a."
                    formatDisplay={(v) => `${v.toFixed(1)}% p.a.`}
                  />
                  <Slider
                    label="Loan Term"
                    value={term}
                    min={5}
                    max={40}
                    step={1}
                    onChange={setTerm}
                    prefix=""
                    suffix=" years"
                    formatDisplay={(v) => `${v} years`}
                  />
                  <ToggleGroup
                    label="Repayment Frequency"
                    options={[
                      { label: "Monthly", value: "monthly" },
                      { label: "Fortnightly", value: "fortnightly" },
                      { label: "Weekly", value: "weekly" },
                    ]}
                    value={frequency}
                    onChange={setFrequency}
                  />

                  <div className="glow-line rounded-full my-2" />

                  <Slider
                    label="Extra Repayment"
                    value={extraRepay}
                    min={0}
                    max={2000}
                    step={50}
                    onChange={setExtraRepay}
                    formatDisplay={(v) => `${fmt(v)}/mo`}
                  />
                  <Slider
                    label="Offset Balance"
                    value={offset}
                    min={0}
                    max={200000}
                    step={5000}
                    onChange={setOffset}
                  />

                  {/* First Home Toggle */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: "#7a8599" }}>
                        First Home Buyer ({selectedState})
                      </span>
                      <button
                        onClick={() => setIsFirstHome(!isFirstHome)}
                        className="relative w-12 h-6 rounded-full transition-colors duration-200"
                        style={{ background: isFirstHome ? "#4ecdc4" : "#2a3040" }}
                      >
                        <div
                          className="absolute top-1 w-4 h-4 rounded-full transition-transform duration-200"
                          style={{
                            background: isFirstHome ? "#0f1520" : "#555e6e",
                            left: "4px",
                            transform: isFirstHome ? "translateX(24px)" : "translateX(0)",
                          }}
                        />
                      </button>
                    </div>
                    {isFirstHome && FIRST_HOME_EXEMPTIONS[selectedState]?.exempt === 0 && (
                      <p className="text-xs" style={{ color: "#fbbf24" }}>
                        {selectedState} offers first home grants rather than duty concessions.
                      </p>
                    )}
                    {isFirstHome && FIRST_HOME_EXEMPTIONS[selectedState]?.exempt > 0 && (
                      <p className="text-xs" style={{ color: "#4ecdc4" }}>
                        Exempt ≤{fmt(FIRST_HOME_EXEMPTIONS[selectedState].exempt)}, sliding concession to{" "}
                        {fmt(FIRST_HOME_EXEMPTIONS[selectedState].ceiling)}.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Slider
                    label="Gross Annual Income"
                    value={income}
                    min={40000}
                    max={500000}
                    step={5000}
                    onChange={setIncome}
                  />
                  <Slider
                    label="Monthly Expenses"
                    value={expenses}
                    min={500}
                    max={10000}
                    step={100}
                    onChange={setExpenses}
                    formatDisplay={(v) => `${fmt(v)}/mo`}
                  />
                  <Slider
                    label="Interest Rate"
                    value={rate}
                    min={2}
                    max={12}
                    step={0.1}
                    onChange={setRate}
                    prefix=""
                    suffix="% p.a."
                    formatDisplay={(v) => `${v.toFixed(1)}% p.a.`}
                  />
                  <Slider
                    label="Loan Term"
                    value={term}
                    min={5}
                    max={40}
                    step={1}
                    onChange={setTerm}
                    prefix=""
                    suffix=" years"
                    formatDisplay={(v) => `${v} years`}
                  />
                  <Slider
                    label="Deposit"
                    value={depositPct}
                    min={5}
                    max={50}
                    step={1}
                    onChange={setDepositPct}
                    prefix=""
                    suffix="%"
                    formatDisplay={(v) => `${v}%`}
                  />
                </>
              )}
            </div>

            {/* ── UPFRONT COSTS (repayment tab) ── */}
            {tab === "repayment" && (
              <div className="card-glass space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                  Upfront Costs
                </div>
                <div className="space-y-2">
                  {[
                    ["Deposit", fmt(deposit)],
                    [`Stamp Duty (${selectedState})`, fmt(results.stampDuty), isFirstHome && FIRST_HOME_EXEMPTIONS[selectedState]?.exempt > 0 && homePrice <= FIRST_HOME_EXEMPTIONS[selectedState].exempt ? "EXEMPT" : null],
                    ...(results.lmi > 0 ? [["LMI", fmt(results.lmi), `LVR ${lvr.toFixed(0)}%`]] : []),
                  ].map(([label, val, badge], i) => (
                    <div key={i} className="flex justify-between items-center py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: "#7a8599" }}>{label}</span>
                        {badge && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "#4ecdc420", color: "#4ecdc4" }}>
                            {badge}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: "#e8eaed", fontFamily: "'DM Mono', monospace" }}>
                        {val}
                      </span>
                    </div>
                  ))}
                  <div className="glow-line rounded-full my-1" />
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-sm font-semibold" style={{ color: "#e8eaed" }}>Total Upfront</span>
                    <span className="text-lg font-bold tabular-nums" style={{ color: "#4ecdc4", fontFamily: "'DM Mono', monospace" }}>
                      {fmt(upfrontCosts)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── RIGHT: RESULTS (3 cols) ─── */}
          <div className="lg:col-span-3 space-y-4 fade-up fade-up-d2">
            {tab === "repayment" ? (
              <>
                {/* Big payment number */}
                <div className="card-glass text-center">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#6b7588" }}>
                    Your repayment per {frequencyLabel(frequency).toLowerCase()}
                  </div>
                  <div
                    className="text-4xl md:text-5xl font-bold tabular-nums mb-1"
                    style={{
                      background: "linear-gradient(135deg, #4ecdc4, #3b82a0)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {fmt(Math.round(displayPayment))}
                  </div>
                  <div className="text-sm" style={{ color: "#555e6e" }}>
                    on a {fmt(loanAmount)} loan at {rate.toFixed(1)}% over {term} yrs
                    {extraRepay > 0 && (
                      <span style={{ color: "#4ecdc4" }}> + {fmt(extraRepay)} extra/mo</span>
                    )}
                  </div>
                  {results.actualMonths < term * 12 && extraRepay > 0 && (
                    <div className="mt-2 text-sm font-medium" style={{ color: "#4ecdc4" }}>
                      ✨ Paid off in {Math.ceil(results.actualMonths / 12)} years ({term - Math.ceil(results.actualMonths / 12)} yrs early!)
                    </div>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard label="Total Interest" value={fmt(results.totalInterest)} accent />
                  <StatCard label="Total Paid" value={fmt(results.totalPaid)} />
                  <StatCard label="Loan Amount" value={fmt(loanAmount)} sub={`LVR ${lvr.toFixed(0)}%`} />
                </div>

                {/* Charts row */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* Pie */}
                  <div className="card-glass">
                    <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                      Cost Breakdown
                    </div>
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {pieData.map((d, i) => (
                            <Cell key={i} fill={d.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                      {pieData.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs" style={{ color: "#7a8599" }}>
                          <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                          {d.name}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Area chart - amortization */}
                  <div className="card-glass">
                    <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                      Balance Over Time
                    </div>
                    <ResponsiveContainer width="100%" height={170}>
                      <AreaChart data={results.yearlyData}>
                        <defs>
                          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4ecdc4" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#4ecdc4" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" />
                        <XAxis dataKey="year" tick={{ fill: "#555e6e", fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: "#555e6e", fontSize: 11 }} tickFormatter={fmtShort} tickLine={false} axisLine={false} width={45} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="balance" stroke="#4ecdc4" fill="url(#balGrad)" strokeWidth={2} name="Balance" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Interest vs Principal stacked */}
                <div className="card-glass">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                    Annual Principal vs Interest
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={results.yearlyData}>
                      <defs>
                        <linearGradient id="intGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f97066" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#f97066" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="prinGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4ecdc4" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#4ecdc4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" />
                      <XAxis dataKey="year" tick={{ fill: "#555e6e", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: "#555e6e", fontSize: 11 }} tickFormatter={fmtShort} tickLine={false} axisLine={false} width={45} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="interest" stroke="#f97066" fill="url(#intGrad)" strokeWidth={2} name="Interest" stackId="1" />
                      <Area type="monotone" dataKey="principal" stroke="#4ecdc4" fill="url(#prinGrad)" strokeWidth={2} name="Principal" stackId="1" />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-6 mt-2">
                    {[
                      { color: "#f97066", label: "Interest" },
                      { color: "#4ecdc4", label: "Principal" },
                    ].map((l, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs" style={{ color: "#7a8599" }}>
                        <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                        {l.label}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Amortization table (first 5 years summary) */}
                <div className="card-glass overflow-x-auto">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                    Amortization Summary
                  </div>
                  <table className="w-full text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>
                    <thead>
                      <tr style={{ color: "#555e6e" }}>
                        <th className="text-left py-2 font-medium">Year</th>
                        <th className="text-right py-2 font-medium">Principal</th>
                        <th className="text-right py-2 font-medium">Interest</th>
                        <th className="text-right py-2 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.yearlyData
                        .filter((_, i) => i < 5 || i === results.yearlyData.length - 1)
                        .map((row, i, arr) => (
                          <tr key={row.year} style={{ borderTop: "1px solid #2a3040" }}>
                            <td className="py-2.5" style={{ color: "#7a8599" }}>
                              {i === arr.length - 1 && i >= 5 ? `${row.year} (final)` : row.year}
                            </td>
                            <td className="text-right py-2.5" style={{ color: "#4ecdc4" }}>
                              {fmt(row.principal)}
                            </td>
                            <td className="text-right py-2.5" style={{ color: "#f97066" }}>
                              {fmt(row.interest)}
                            </td>
                            <td className="text-right py-2.5" style={{ color: "#e8eaed" }}>
                              {fmt(row.balance)}
                            </td>
                          </tr>
                        ))}
                      {results.yearlyData.length > 6 && (
                        <tr>
                          <td colSpan={4} className="text-center py-2" style={{ color: "#555e6e" }}>
                            ···
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              /* ── AFFORDABILITY TAB ── */
              <>
                <div className="card-glass text-center">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "#6b7588" }}>
                    Max property you could afford
                  </div>
                  <div
                    className="text-4xl md:text-5xl font-bold tabular-nums mb-1"
                    style={{
                      background: "linear-gradient(135deg, #4ecdc4, #3b82a0)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {fmt(results.maxPrice)}
                  </div>
                  <div className="text-sm" style={{ color: "#555e6e" }}>
                    Based on 35% debt-to-income ratio at {rate.toFixed(1)}%
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <StatCard label="Max Loan" value={fmt(results.maxLoan)} accent />
                  <StatCard
                    label="Max Repayment"
                    value={`${fmt(Math.round(results.maxMonthly))}/mo`}
                  />
                  <StatCard
                    label="Deposit Needed"
                    value={fmt(Math.round(results.maxPrice * depositPct / 100))}
                    sub={`${depositPct}% of price`}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="card-glass">
                    <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                      Loan vs Deposit
                    </div>
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie
                          data={affordPie}
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                          strokeWidth={0}
                        >
                          {affordPie.map((d, i) => (
                            <Cell key={i} fill={d.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-2">
                      {affordPie.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs" style={{ color: "#7a8599" }}>
                          <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                          {d.name}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card-glass space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7588" }}>
                      Income Breakdown
                    </div>
                    {(() => {
                      const monthlyInc = income / 12;
                      const maxPay = Math.round(results.maxMonthly);
                      const remaining = Math.round(monthlyInc - expenses - maxPay);
                      const segments = [
                        { label: "Mortgage", amount: maxPay, color: "#4ecdc4", pct: (maxPay / monthlyInc) * 100 },
                        { label: "Expenses", amount: expenses, color: "#f97066", pct: (expenses / monthlyInc) * 100 },
                        { label: "Remaining", amount: Math.max(remaining, 0), color: "#555e6e", pct: (Math.max(remaining, 0) / monthlyInc) * 100 },
                      ];
                      return (
                        <>
                          <div className="flex rounded-full overflow-hidden h-3" style={{ background: "#1a2235" }}>
                            {segments.map((s, i) => (
                              <div key={i} style={{ width: `${s.pct}%`, background: s.color }} />
                            ))}
                          </div>
                          <div className="space-y-2">
                            {segments.map((s, i) => (
                              <div key={i} className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                  <span className="text-sm" style={{ color: "#7a8599" }}>{s.label}</span>
                                </div>
                                <span className="text-sm font-medium tabular-nums" style={{ color: "#e8eaed", fontFamily: "'DM Mono', monospace" }}>
                                  {fmt(s.amount)}/mo
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="pt-2" style={{ borderTop: "1px solid #2a3040" }}>
                            <div className="flex justify-between">
                              <span className="text-xs" style={{ color: "#555e6e" }}>Monthly income</span>
                              <span className="text-xs font-medium" style={{ color: "#7a8599", fontFamily: "'DM Mono', monospace" }}>
                                {fmt(Math.round(monthlyInc))}/mo
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="card-glass">
                  <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#6b7588" }}>
                    Estimated Upfront Costs at Max Price
                  </div>
                  {(() => {
                    const sd = calculateStampDuty(results.maxPrice, selectedState, false);
                    const dep = Math.round(results.maxPrice * depositPct / 100);
                    const mLmi = calculateLMI(results.maxLoan, (1 - depositPct / 100) * 100);
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Deposit" value={fmt(dep)} />
                        <StatCard label="Stamp Duty" value={fmt(sd)} />
                        {mLmi > 0 && <StatCard label="LMI" value={fmt(mLmi)} />}
                        <StatCard label="Total" value={fmt(dep + sd + mLmi)} accent />
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer className="text-center py-5" style={{ borderTop: "1px solid #1e2838", padding: "20px 15px" }}>
        <p className="text-xs" style={{ color: "#444d5e" }}>
          Estimates only — consult a financial advisor. {selectedState} stamp duty rates 2024. LMI is approximate.
        </p>
      </footer>

      </div>
    </div>
  );
}
