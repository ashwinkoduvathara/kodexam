import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const DARK_LOGO =
  "https://res.cloudinary.com/tagvmejc/image/upload/v1787687338/kodeversity_green_final_logo_copy_tqygan.png";
const LIGHT_LOGO =
  "https://res.cloudinary.com/tagvmejc/image/upload/v1787687338/kodeversity_white_final_logo_copy_pwhu9c.png";

/**
 * Kodeversity logo (same assets as the LMS `Logo`).
 * `linked={false}` renders a static image — used inside the exam shell so the
 * logo can't navigate a candidate out of an active attempt.
 */
export function Logo({
  light = false,
  linked = true,
  className,
}: {
  light?: boolean;
  linked?: boolean;
  className?: string;
}) {
  const img = (
    <img
      src={light ? LIGHT_LOGO : DARK_LOGO}
      alt="Kodeversity"
      width={285}
      height={60}
      className={cn("h-10 sm:h-12 w-auto", className)}
    />
  );

  if (!linked) return img;
  return (
    <Link to="/" className="inline-block cursor-pointer">
      {img}
    </Link>
  );
}
