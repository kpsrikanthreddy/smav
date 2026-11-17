import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
}

const PADDING_MAP = {
  none: '',
  sm: 'p-3.5',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
};

export const Card: React.FC<CardProps> = React.memo(({
  padding = 'md',
  interactive = false,
  className = '',
  children,
  ...rest
}) => {
  return (
    <div
      className={`bg-white border border-[#E5E7EC] rounded-2xl shadow-[0_1px_3px_rgba(16,24,40,0.04)] ${
        interactive ? 'hover:border-[#D3D7E0] hover:shadow-[0_4px_12px_rgba(16,24,40,0.06)] transition-all' : ''
      } ${PADDING_MAP[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

Card.displayName = 'Card';
