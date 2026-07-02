import React, { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export const TagInput: React.FC<Props> = ({ tags, onChange, placeholder = 'Add tag...' }) => {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => onChange(tags.filter(t => t !== tag));

  return (
    <div className="flex flex-wrap gap-1.5 min-h-[40px] px-3 py-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent bg-white">
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-sm">
          {tag}
          <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500">
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] outline-none text-sm bg-transparent"
      />
    </div>
  );
};
