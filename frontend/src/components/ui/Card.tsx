import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

const Card: React.FC<CardProps> = ({
  children,
  className = '',
  hoverable = false,
  onClick,
  title,
  actions,
}) => {
  return (
    <motion.div
      whileHover={hoverable ? { y: -4, transition: { duration: 0.2 } } : {}}
      className={`bg-white rounded-xl border border-gray-100 shadow-card transition-all duration-300 ${
        hoverable ? 'cursor-pointer hover:shadow-card-hover' : ''
      } ${className}`}
      onClick={onClick}
    >
      {title && (
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-6">{children}</div>
    </motion.div>
  );
};

export default Card;
