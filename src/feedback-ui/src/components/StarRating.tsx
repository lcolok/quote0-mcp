import React from 'react';
import { Star } from 'lucide-react';
import { motion } from 'framer-motion';

interface StarRatingProps {
  value: number;
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  readonly?: boolean;
}

const StarRating: React.FC<StarRatingProps> = ({ 
  value, 
  onChange, 
  size = 'md',
  readonly = false 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6', 
    lg: 'w-8 h-8'
  };

  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <motion.button
          key={star}
          type="button"
          className={`${sizeClasses[size]} transition-colors duration-200 ${
            readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'
          }`}
          onClick={() => !readonly && onChange(star)}
          whileHover={readonly ? {} : { scale: 1.1 }}
          whileTap={readonly ? {} : { scale: 0.95 }}
          disabled={readonly}
        >
          <Star
            className={`w-full h-full transition-colors duration-200 ${
              star <= value
                ? 'fill-yellow-400 text-yellow-400'
                : 'fill-gray-200 text-gray-300 hover:text-yellow-300'
            }`}
          />
        </motion.button>
      ))}
      <span className="ml-2 text-sm text-gray-600 font-medium">
        {value}/5
        {readonly && (
          <span className="text-xs ml-1">
            ({value === 5 ? '优秀' : value === 4 ? '良好' : value === 3 ? '一般' : value === 2 ? '较差' : '很差'})
          </span>
        )}
      </span>
    </div>
  );
};

export default StarRating;