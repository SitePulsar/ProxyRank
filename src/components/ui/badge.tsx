import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline" | "warning" | "success" | "destructive";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        {
          "bg-primary/10 text-primary border border-primary/20": variant === "default",
          "border border-border text-muted-foreground": variant === "outline",
          "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20": variant === "warning",
          "bg-green-500/10 text-green-400 border border-green-500/20": variant === "success",
          "bg-red-500/10 text-red-400 border border-red-500/20": variant === "destructive",
        },
        className
      )}
      {...props}
    />
  );
}
