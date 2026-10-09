import { ClipboardList } from "lucide-react";
import type { ExamInstruction } from "@/types/exam";
import { InstructionItem } from "../instructions/InstructionItem";
import { SectionHeading } from "../instructions/SectionHeading";

/** Fixed start-of-exam reminders (not exam-authored), rendered with the Screen 2 row style. */
function reminders(allowPause: boolean): ExamInstruction[] {
  return [
    {
      id: "timer",
      icon: "clock",
      title: "Your timer will start now",
      description: allowPause
        ? "Once you click Start Exam, the examination timer will begin."
        : "Once you click Start Exam, the examination timer will begin. You cannot pause the examination once it has started.",
    },
    {
      id: "environment",
      icon: "monitor",
      title: "Stay in the exam environment",
      description: "Do not switch browser tabs, windows or applications during the examination.",
    },
    {
      id: "devices",
      icon: "camera",
      title: "Keep your camera and microphone on",
      description:
        "Your camera and microphone must remain enabled throughout the examination when required by the exam policy.",
    },
    {
      id: "rules",
      icon: "shield",
      title: "Follow all examination rules",
      description:
        "Any violation of the examination rules may result in disqualification according to the applicable examination policy.",
    },
  ];
}

export function BeforeYouStart({ allowPause }: { allowPause: boolean }) {
  return (
    <section
      aria-labelledby="before-you-start-heading"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <SectionHeading
        id="before-you-start-heading"
        icon={ClipboardList}
        title="Before You Start"
        description="Please read the following important information."
      />
      <ul className="mt-3.5 flex flex-col gap-2.5">
        {reminders(allowPause).map((item) => (
          <InstructionItem key={item.id} instruction={item} />
        ))}
      </ul>
    </section>
  );
}
