import {
  BookOpen,
  CandyOff,
  Droplets,
  Dumbbell,
  Footprints,
  Heart,
  Moon,
  Pill,
  Sun,
  Utensils,
} from 'lucide-react';
import type { HabitColor, HabitIcon } from '../../db/types';

const icons = {
  water: Droplets,
  food: Utensils,
  workout: Dumbbell,
  sleep: Moon,
  steps: Footprints,
  vitamin: Pill,
  sugar: CandyOff,
  heart: Heart,
  book: BookOpen,
  sun: Sun,
};

export default function HabitSymbol({
  icon,
  color,
  className = '',
}: {
  icon: HabitIcon;
  color: HabitColor;
  className?: string;
}) {
  const Icon = icons[icon];
  return (
    <span className={`tone-${color} tone-icon ${className}`} aria-hidden="true">
      <Icon size={23} strokeWidth={1.8} />
    </span>
  );
}
