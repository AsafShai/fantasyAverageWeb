import React, { useState } from 'react';

interface CollapsibleTableProps {
  title: string;
  collapsedLabel?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export const CollapsibleTable: React.FC<CollapsibleTableProps> = ({
  title,
  collapsedLabel,
  children,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
      >
        <div>
          <h3 className="font-medium text-gray-900">{title}</h3>
          {!isExpanded && collapsedLabel && (
            <p className="text-sm text-gray-600 mt-1">{collapsedLabel}</p>
          )}
        </div>
        <span
          className={`transform transition-transform duration-200 text-gray-500 ${
            isExpanded ? 'rotate-180' : ''
          }`}
        >
          ▼
        </span>
      </button>
      
      {isExpanded && (
        <div className="bg-white">
          {children}
        </div>
      )}
    </div>
  );
};