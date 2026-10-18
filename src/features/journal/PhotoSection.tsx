import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Images, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { Button, Card, Confirm, EmptyState, Field, IconButton, Modal } from '../../components/ui';
import { db, uid } from '../../db';
import type { Photo, Settings } from '../../db/types';
import { formatDate, isISODate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { run } from '../../store/ui';
import { compressPhoto, validatePhotoFile } from './photoCompression';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const safeSource = (value: string) =>
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
function PhotoEditor({
  initialDate,
  settings,
  onClose,
}: {
  initialDate: string;
  settings: Settings;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!file) {
      setError('یک فایل عکس انتخاب کنید.');
      return;
    }
    if (!isISODate(date)) {
      setError('یک تاریخ معتبر برای عکس انتخاب کنید.');
      return;
    }
    const fileError = validatePhotoFile(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    const destination = { date, note, id: uid() },
      source = file;
    lock.current = true;
    setBusy(true);
    setError('');
    let detail = '';
    const ok = await run(async () => {
      try {
        const result = await compressPhoto(source);
        await db.photos.put({ ...destination, dataUrl: result.dataUrl });
      } catch (cause) {
        if (cause instanceof Error && /[؀-ۿ]/.test(cause.message)) detail = cause.message;
        throw cause;
      }
    }, 'عکس فشرده‌شده روی این دستگاه ذخیره شد.');
    lock.current = false;
    setBusy(false);
    if (ok) onClose();
    else
      setError(
        `عکس ذخیره نشد. ${detail || 'فایل و پیش‌نویس حفظ شده‌اند؛ فضای دستگاه را بررسی کنید یا دوباره تلاش کنید.'}`,
      );
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!lock.current) onClose();
      }}
      title="افزودن عکس محلی"
    >
      <form className="stack" onSubmit={save} noValidate aria-busy={busy}>
        {error && (
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="banner"
            style={{ borderColor: 'var(--danger)' }}
          >
            {error}
          </p>
        )}
        <p className="muted small">
          فقط JPEG، PNG و WebP تا ۱۰ مگابایت. خروجی JPEG با ضلع بلند حداکثر ۱۲۸۰ پیکسل و حجم حداکثر
          ۵۱۲ کیلوبایت ذخیره می‌شود. زمینهٔ شفاف سفید می‌شود.
        </p>
        <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
          <Field label="فایل عکس">
            <input
              aria-label="فایل عکس"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (!selected) return;
                const problem = validatePhotoFile(selected);
                if (problem) {
                  setFile(null);
                  setError(problem);
                  event.target.value = '';
                  return;
                }
                setFile(selected);
                setError('');
              }}
            />
          </Field>
          {preview && (
            <figure className="m-0 stack">
              <img
                className="w-full rounded-xl object-contain"
                style={{ maxHeight: 280, background: 'var(--surface-soft)' }}
                src={preview}
                alt="پیش‌نمایش عکس انتخاب‌شده"
              />
              <figcaption className="muted small">
                این فقط پیش‌نمایش است؛ عکس تا زدن دکمهٔ ذخیره ثبت نمی‌شود.
              </figcaption>
            </figure>
          )}
          <Field label="تاریخ عکس">
            <input
              aria-label="تاریخ عکس"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <p className="muted small">
            مقصد این عکس: {isISODate(date) ? formatDate(date, settings) : 'تاریخ معتبر انتخاب کنید'}
            . تغییر روز سربرگ، این تاریخ را تغییر نمی‌دهد.
          </p>
          <Field label="یادداشت عکس">
            <textarea
              aria-label="یادداشت عکس"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </fieldset>
        {busy && (
          <p role="status" className="muted">
            در حال پردازش و ذخیرهٔ محلی عکس…
          </p>
        )}
        <div className="row flex-wrap">
          <Button type="submit" disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره عکس'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function PhotoComparison({
  side,
  date,
  photos,
  settings,
  selected,
  onSelect,
}: {
  side: 'اول' | 'دوم';
  date: string;
  photos: Photo[];
  settings: Settings;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const candidates = photos.filter((photo) => photo.date === date);
  // Derive a valid current selection on every reactive update; a deleted image is never retained.
  const current = candidates.find((photo) => photo.id === selected) ?? candidates[0];
  return (
    <section
      aria-label={`عکس ${side} مقایسه`}
      className="stack min-w-0 rounded-2xl border p-4"
      style={{ borderColor: 'var(--line)', background: 'var(--surface-soft)' }}
    >
      <h3>عکس {side}</h3>
      {candidates.length > 1 && (
        <Field label={`انتخاب عکس ${side}`}>
          <select
            aria-label={`انتخاب عکس ${side}`}
            value={current?.id ?? ''}
            onChange={(event) => onSelect(event.target.value)}
          >
            {candidates.map((photo, index) => (
              <option
                key={photo.id}
                value={photo.id}
              >{`عکس ${formatNumber(index + 1, settings)}${photo.note ? `، ${photo.note}` : '، بدون یادداشت'}`}</option>
            ))}
          </select>
        </Field>
      )}
      {!isISODate(date) ? (
        <p className="muted">یک تاریخ معتبر انتخاب کنید.</p>
      ) : !current ? (
        <EmptyState
          icon={Images}
          title="عکسی برای این تاریخ ندارید"
          description="یک تاریخ دیگر انتخاب کنید یا عکس این روز را اضافه کنید."
        />
      ) : (
        <figure className="m-0 stack">
          {safeSource(current.dataUrl) ? (
            <img
              src={current.dataUrl}
              alt={`عکس ${side} در ${formatDate(date, settings)}؛ ${current.note || 'بدون یادداشت'}`}
              className="w-full rounded-xl object-contain"
              style={{ height: 300, background: 'var(--surface)' }}
            />
          ) : (
            <p role="alert">فایل این عکس قابل‌نمایش نیست.</p>
          )}
          <figcaption className="stack">
            <time dateTime={date} className="small">
              {formatDate(date, settings)}
            </time>
            <p className="small whitespace-pre-wrap break-words">
              {current.note || 'بدون یادداشت'}
            </p>
          </figcaption>
        </figure>
      )}
    </section>
  );
}
export default function PhotoSection({ date, settings }: { date: string; settings: Settings }) {
  const [reload, setReload] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      return {
        photos: (await db.photos.toArray()).sort(
          (a, b) => compare(a.date, b.date) || compare(a.id, b.id),
        ),
        error: false,
      };
    } catch {
      return { photos: [] as Photo[], error: true };
    }
  }, [reload]);
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [firstDate, setFirstDate] = useState(date);
  const [secondDate, setSecondDate] = useState(date);
  const [firstPhoto, setFirstPhoto] = useState('');
  const [secondPhoto, setSecondPhoto] = useState('');
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteLock = useRef(false);
  const photos = result?.photos ?? [],
    dayPhotos = photos.filter((photo) => photo.date === date);
  async function remove() {
    if (!deleting || deleteLock.current) return;
    const id = deleting.id;
    deleteLock.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    const ok = await run(() => db.photos.delete(id), 'عکس انتخاب‌شده حذف شد.');
    deleteLock.current = false;
    setDeleteBusy(false);
    if (ok) setDeleting(null);
    else {
      setDeleting(null);
      setDeleteError('حذف عکس انجام نشد. عکس شما محفوظ است؛ دوباره تلاش کنید.');
    }
  }
  return (
    <Card className="stack">
      <div className="row flex-wrap justify-between">
        <h2 className="row">
          <Camera size={22} aria-hidden="true" />
          عکس‌های محلی
        </h2>
        <Button variant="secondary" onClick={() => setEditorDate(date)}>
          <Plus size={18} aria-hidden="true" />
          افزودن عکس
        </Button>
      </div>
      <p className="row small muted">
        <LockKeyhole size={18} aria-hidden="true" />
        عکس‌ها فقط در همین مرورگر ذخیره می‌شوند و به هیچ سروری ارسال نمی‌شوند.
      </p>
      <h3>عکس‌های {formatDate(date, settings)}</h3>
      {result === undefined ? (
        <p role="status" className="banner">
          در حال خواندن عکس‌های محلی…
        </p>
      ) : result.error ? (
        <div className="stack">
          <p role="alert" className="banner">
            خواندن عکس‌ها انجام نشد. دسترسی مرورگر به حافظهٔ محلی را بررسی کنید.
          </p>
          <Button variant="secondary" onClick={() => setReload((current) => current + 1)}>
            تلاش دوباره
          </Button>
        </div>
      ) : (
        <>
          {dayPhotos.length === 0 ? (
            <EmptyState
              icon={Camera}
              title="هنوز عکسی برای این روز ندارید"
              description="یک عکس محلی انتخاب کنید. قبل از ثبت، پیش‌نمایش آن را می‌بینید."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dayPhotos.map((photo, index) => (
                <figure
                  key={photo.id}
                  className="m-0 stack rounded-2xl border p-3"
                  style={{ borderColor: 'var(--line)' }}
                >
                  {safeSource(photo.dataUrl) ? (
                    <img
                      loading="lazy"
                      src={photo.dataUrl}
                      alt={`عکس ${formatNumber(index + 1, settings)} در ${formatDate(photo.date, settings)}؛ ${photo.note || 'بدون یادداشت'}`}
                      className="w-full rounded-xl object-contain"
                      style={{ height: 220, background: 'var(--surface-soft)' }}
                    />
                  ) : (
                    <p role="alert">فایل این عکس قابل‌نمایش نیست.</p>
                  )}
                  <figcaption className="stack">
                    <div className="row justify-between">
                      <time dateTime={photo.date} className="small">
                        {formatDate(photo.date, settings)}
                      </time>
                      <IconButton
                        label={`حذف عکس ${formatNumber(index + 1, settings)}`}
                        onClick={() => {
                          setDeleteError('');
                          setDeleting(photo);
                        }}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </IconButton>
                    </div>
                    <p className="small whitespace-pre-wrap break-words">
                      {photo.note || 'بدون یادداشت'}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <div className="stack border-t pt-5" style={{ borderColor: 'var(--line)' }}>
            <h3 className="row">
              <Images size={20} aria-hidden="true" />
              مقایسهٔ دو تاریخ
            </h3>
            <p className="muted small">
              این دو تاریخ مستقل از روز سربرگ هستند. اگر در یک روز چند عکس دارید، عکس هر طرف را
              انتخاب کنید.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="تاریخ اول مقایسه">
                <input
                  aria-label="تاریخ اول مقایسه"
                  type="date"
                  value={firstDate}
                  onChange={(event) => {
                    setFirstDate(event.target.value);
                    setFirstPhoto('');
                  }}
                />
              </Field>
              <Field label="تاریخ دوم مقایسه">
                <input
                  aria-label="تاریخ دوم مقایسه"
                  type="date"
                  value={secondDate}
                  onChange={(event) => {
                    setSecondDate(event.target.value);
                    setSecondPhoto('');
                  }}
                />
              </Field>
            </div>
            {firstDate === secondDate && (
              <p className="banner">برای مقایسه، دو تاریخ متفاوت انتخاب کنید.</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <PhotoComparison
                side="اول"
                date={firstDate}
                photos={photos}
                settings={settings}
                selected={firstPhoto}
                onSelect={setFirstPhoto}
              />
              <PhotoComparison
                side="دوم"
                date={secondDate}
                photos={photos}
                settings={settings}
                selected={secondPhoto}
                onSelect={setSecondPhoto}
              />
            </div>
          </div>
        </>
      )}
      {deleteError && (
        <p role="alert" className="banner">
          {deleteError}
        </p>
      )}
      {deleteBusy && <p role="status">در حال حذف عکس انتخاب‌شده…</p>}
      <Confirm
        open={deleting !== null}
        title="حذف این عکس؟"
        description={`فقط عکس انتخاب‌شده در ${deleting ? formatDate(deleting.date, settings) : ''} حذف می‌شود. این کار قابل‌بازگشت نیست.`}
        danger
        onClose={() => {
          if (!deleteLock.current) setDeleting(null);
        }}
        onConfirm={() => {
          void remove();
        }}
      />
      {editorDate !== null && (
        <PhotoEditor
          initialDate={editorDate}
          settings={settings}
          onClose={() => setEditorDate(null)}
        />
      )}
    </Card>
  );
}
