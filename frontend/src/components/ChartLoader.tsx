import { motion } from "motion/react";
import { useTranslation } from "@/i18n";

export function ChartLoader({ theme }: { theme: "dark" | "light" }) {
  const { t } = useTranslation();
  const isLight = theme === "light";

  const bars = [0.5, 0.85, 0.65, 1.0, 0.7, 0.9, 0.55];
  const green = "rgb(16, 185, 129)";
  const red = "rgb(239, 68, 68)";

  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-3">
      <div className="flex items-end gap-[3px] h-10">
        {bars.map((h, i) => {
          const color = i % 2 === 0 ? green : red;
          return (
            <motion.span
              key={i}
              className="block w-[5px] rounded-[1px]"
              style={{
                height: `${h * 100}%`,
                backgroundColor: color,
                boxShadow: `0 0 ${isLight ? 8 : 6}px ${color}`,
                transformOrigin: "bottom",
              }}
              animate={{ scaleY: [1, 0.45, 1], opacity: [1, 0.6, 1] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.08,
              }}
            />
          );
        })}
      </div>
      <span className={`text-sm ${isLight ? "text-slate-600" : "text-zinc-400"}`}>
        {t("common.loading")}
      </span>
    </div>
  );
}
