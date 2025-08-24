import React, { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface CardProps {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  delay?: number;
}

const Card: React.FC<CardProps> = ({ 
  title, 
  icon: Icon, 
  children, 
  className = '', 
  delay = 0 
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={`glass-morphism rounded-xl p-6 ${className}`}
    >
      <div className="flex items-center gap-3 mb-6">
        {Icon && (
          <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
            <Icon className="w-5 h-5 text-white" />
          </div>
        )}
        <h2 className="text-xl font-semibold gradient-text">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
};

export default Card;