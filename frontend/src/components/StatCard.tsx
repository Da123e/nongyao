import React from 'react';
import { motion } from 'framer-motion';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: string;
  color: 'green' | 'emerald' | 'blue' | 'purple' | 'orange' | 'cyan' | 'pink' | 'red';
}

const colorClasses = {
  green: {
    bg: 'bg-primary-100',
    icon: 'text-primary-600',
    border: 'border-primary-200',
  },
  emerald: {
    bg: 'bg-emerald-100',
    icon: 'text-emerald-600',
    border: 'border-emerald-200',
  },
  blue: {
    bg: 'bg-blue-100',
    icon: 'text-blue-600',
    border: 'border-blue-200',
  },
  purple: {
    bg: 'bg-purple-100',
    icon: 'text-purple-600',
    border: 'border-purple-200',
  },
  orange: {
    bg: 'bg-orange-100',
    icon: 'text-orange-600',
    border: 'border-orange-200',
  },
  cyan: {
    bg: 'bg-cyan-100',
    icon: 'text-cyan-600',
    border: 'border-cyan-200',
  },
  pink: {
    bg: 'bg-pink-100',
    icon: 'text-pink-600',
    border: 'border-pink-200',
  },
  red: {
    bg: 'bg-red-100',
    icon: 'text-red-600',
    border: 'border-red-200',
  },
};

function StatCard({ icon, label, value, trend, color }: StatCardProps) {
  const colors = colorClasses[color];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-white rounded-xl p-6 shadow-card border border-gray-100 hover:shadow-card-hover transition-all duration-300"
    >
      <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center mb-4`}>
        <span className={colors.icon}>{icon}</span>
      </div>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-800">{value}</span>
        {trend && (
          <span className={`text-sm font-medium ${trend.startsWith('+') ? 'text-success-500' : 'text-danger-500'}`}>
            {trend}
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default StatCard;
