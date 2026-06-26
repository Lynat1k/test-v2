import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';

const ease = [0.16, 1, 0.3, 1] as const;

type LightboxImage = { src: string; alt: string } | null;

type LightboxCtx = {
  openLightbox: (src: string, alt: string) => void;
  closeLightbox: () => void;
};

const Ctx = createContext<LightboxCtx | null>(null);

export function useLightbox(): LightboxCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLightbox must be used within <LightboxProvider>');
  return ctx;
}

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<LightboxImage>(null);

  const openLightbox = useCallback((src: string, alt: string) => setImage({ src, alt }), []);
  const closeLightbox = useCallback(() => setImage(null), []);

  return (
    <Ctx.Provider value={{ openLightbox, closeLightbox }}>
      {children}
      <LightboxOverlay image={image} onClose={closeLightbox} />
    </Ctx.Provider>
  );
}

function LightboxOverlay({ image, onClose }: { image: LightboxImage; onClose: () => void }) {
  // Esc to close + lock body scroll while open.
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  return (
    <AnimatePresence>
      {image && (
        <motion.div
          key="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          tabIndex={-1}
          ref={(el) => {
            el?.focus();
          }}
          onClick={onClose}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 cursor-default outline-none"
          // backdrop-filter inline (not via .css) so lightningcss can't drop the standard prop in prod
          style={{ background: 'rgba(2,3,6,0.86)', backdropFilter: 'blur(6px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <motion.img
            src={image.src}
            alt={image.alt}
            aria-label={image.alt}
            onClick={onClose}
            className="max-w-[92vw] max-h-[92vh] object-contain rounded-xl cursor-zoom-out shadow-2xl"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
