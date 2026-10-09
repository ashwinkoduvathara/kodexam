import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cleanDeviceLabel } from "@/lib/exam/media";
import { CheckAction } from "./SystemCheckCard";

interface DeviceMenuProps {
  /** Button text, e.g. "Change Camera". */
  label: string;
  /** Accessible name for the picker, e.g. "Choose a camera". */
  ariaLabel: string;
  /** Group heading inside the menu, e.g. "Available cameras". */
  heading: string;
  /** Fallback name for unlabeled devices, e.g. "Camera". */
  fallbackName: string;
  devices: MediaDeviceInfo[];
  activeDeviceId?: string;
  onSelect: (deviceId: string) => void;
  disabled?: boolean;
}

/** Picker for camera/microphone devices. Selecting re-opens and re-verifies the device. */
export function DeviceMenu({
  label,
  ariaLabel,
  heading,
  fallbackName,
  devices,
  activeDeviceId,
  onSelect,
  disabled,
}: DeviceMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <CheckAction
          disabled={disabled || devices.length === 0}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 px-3"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-auto text-slate-400" aria-hidden />
        </CheckAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="kp w-64 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {heading}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={activeDeviceId}
          onValueChange={(id) => {
            if (id !== activeDeviceId) onSelect(id);
          }}
        >
          {devices.map((d, i) => (
            <DropdownMenuRadioItem
              key={d.deviceId}
              value={d.deviceId}
              className="cursor-pointer rounded-lg text-xs font-semibold"
            >
              <span className="truncate">
                {cleanDeviceLabel(d.label, `${fallbackName} ${i + 1}`)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
