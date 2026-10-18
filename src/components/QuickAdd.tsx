import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Droplets, Dumbbell, Moon, Scale, Utensils } from 'lucide-react';
import { Button, Modal } from './ui';
import { changeWater } from '../db';
import { run, useUI } from '../store/ui';
export default function QuickAdd() {
  const { quickAdd, setQuickAdd, date } = useUI();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const go = (route: string) => {
    setQuickAdd(false);
    navigate(route);
  };
  return (
    <Modal open={quickAdd} onClose={() => setQuickAdd(false)} title="یک ثبت کوچک">
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" className="flex-col py-5" onClick={() => go('/health/weight')}>
          <Scale size={27} aria-hidden="true" />
          وزن و اندازه‌ها
        </Button>
        <Button variant="secondary" className="flex-col py-5" onClick={() => go('/health/diet')}>
          <Utensils size={27} aria-hidden="true" />
          وعدهٔ غذایی
        </Button>
        <Button
          variant="secondary"
          className="flex-col py-5"
          onClick={() => go('/health/exercise')}
        >
          <Dumbbell size={27} aria-hidden="true" />
          ورزش و قدم‌ها
        </Button>
        <Button variant="secondary" className="flex-col py-5" onClick={() => go('/health/journal')}>
          <Moon size={27} aria-hidden="true" />
          خواب و حال روز
        </Button>
        <Button
          className="col-span-2"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void run(() => changeWater(date, 250), 'یک لیوان آب ثبت شد.').finally(() =>
              setBusy(false),
            );
          }}
        >
          <Droplets size={21} aria-hidden="true" />
          یک لیوان آب، ۲۵۰ میلی‌لیتر
        </Button>
      </div>
    </Modal>
  );
}
