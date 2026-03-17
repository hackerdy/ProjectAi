"use client";

import { JobStatus, AGENT_STEPS } from "@/types";

interface AgentStatusBarProps {
  status: JobStatus;
  currentAgent: string;
}

export function AgentStatusBar({ status, currentAgent }: AgentStatusBarProps) {
  const getStepState = (stepId: string, stepStatuses: JobStatus[]) => {
    if (status === "completed") return "completed";
    if (status === "failed") {
      const currentIndex = AGENT_STEPS.findIndex((s) =>
        s.statuses.includes(status as JobStatus)
      );
      const stepIndex = AGENT_STEPS.findIndex((s) => s.id === stepId);
      return stepIndex <= currentIndex ? "completed" : "pending";
    }
    if (stepStatuses.includes(status)) return "active";
    const currentIndex = AGENT_STEPS.findIndex((s) =>
      s.statuses.includes(status)
    );
    const stepIndex = AGENT_STEPS.findIndex((s) => s.id === stepId);
    if (stepIndex < currentIndex) return "completed";
    return "pending";
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
          Agent Pipeline
        </h3>
        <span className="text-xs text-gray-500">
          {currentAgent && currentAgent !== "completed" && currentAgent !== "failed"
            ? `Active: ${currentAgent}`
            : status === "completed"
            ? "All done!"
            : status === "failed"
            ? "Failed"
            : ""}
        </span>
      </div>
      <div className="flex items-center gap-0">
        {AGENT_STEPS.map((step, idx) => {
          const state = getStepState(step.id, step.statuses);
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center flex-1">
                {/* Step circle */}
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-lg
                    transition-all duration-500
                    ${
                      state === "active"
                        ? "bg-blue-600 ring-4 ring-blue-200 animate-pulse"
                        : state === "completed"
                        ? "bg-green-500"
                        : "bg-gray-200"
                    }
                  `}
                >
                  {step.icon}
                </div>
                {/* Step label */}
                <span
                  className={`
                    mt-1 text-xs font-medium text-center
                    ${
                      state === "active"
                        ? "text-blue-700"
                        : state === "completed"
                        ? "text-green-700"
                        : "text-gray-400"
                    }
                  `}
                >
                  {step.label}
                </span>
              </div>
              {/* Connector line */}
              {idx < AGENT_STEPS.length - 1 && (
                <div
                  className={`
                    h-0.5 flex-1 -mt-4 transition-all duration-500
                    ${state === "completed" ? "bg-green-400" : "bg-gray-200"}
                  `}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
