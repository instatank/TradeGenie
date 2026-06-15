"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DashboardCharts({
  pnlData,
  mistakeData,
  emotionData,
}: {
  pnlData: { date: string; pnl: number }[];
  mistakeData: { label: string; count: number }[];
  emotionData: { state: string; count: number }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartPanel title="P&L over time">
        <LineChart data={pnlData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5eaee" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={48} />
          <Tooltip />
          <Line type="monotone" dataKey="pnl" stroke="#0d8f72" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartPanel>
      <ChartPanel title="Mistake frequency">
        <BarChart data={mistakeData.slice(0, 8)}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5eaee" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip />
          <Bar dataKey="count" fill="#c2413d" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartPanel>
      <ChartPanel title="Emotional state frequency">
        <BarChart data={emotionData.slice(0, 8)}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5eaee" />
          <XAxis dataKey="state" tick={{ fontSize: 10 }} interval={0} angle={-20} height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip />
          <Bar dataKey="count" fill="#1f6feb" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartPanel>
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <section className="panel">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
