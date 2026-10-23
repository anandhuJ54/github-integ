import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 max-sm:active:opacity-90",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground sm:hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground sm:hover:bg-destructive/90",
        outline: "border border-input bg-background sm:hover:bg-accent sm:hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground sm:hover:bg-secondary/80",
        ghost: "sm:hover:bg-accent sm:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 sm:hover:underline",
        hero: "bg-accent text-accent-foreground sm:hover:bg-accent-hover shadow-elevated font-semibold",
        accent: "bg-gradient-to-r from-blue-500 to-cyan-400 text-white sm:hover:from-blue-600 sm:hover:to-cyan-500 shadow-card font-semibold",
        gradient: "bg-gradient-to-r from-orange-500 to-red-500 text-white sm:hover:from-orange-600 sm:hover:to-red-600 shadow-lg font-semibold",
        white: "bg-white text-[#262626] border border-gray-300 sm:hover:bg-[#28c3ef] sm:hover:text-white sm:hover:border-transparent font-semibold transition-all duration-300",
        whiteOrange: "bg-white text-[#262626] border border-gray-300 sm:hover:bg-gradient-to-r sm:hover:from-orange-500 sm:hover:to-amber-400 sm:hover:text-white sm:hover:border-transparent font-semibold transition-all duration-300",
        whiteOutline: "bg-transparent text-white border-2 border-white sm:hover:bg-gradient-to-r sm:hover:from-blue-500 sm:hover:to-cyan-400 sm:hover:text-white sm:hover:border-transparent font-semibold transition-all duration-300",
        neutral: "bg-[#262626] text-white border border-[#262626] sm:hover:bg-[#2196F3] sm:hover:border-[#2196F3] font-semibold transition-all duration-300",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-7",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
