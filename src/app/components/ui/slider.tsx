"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "./utils";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  isPlaying,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { isPlaying?: boolean }) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none group cursor-pointer",
        "data-[disabled]:opacity-50",
        "data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full",
          isPlaying ? "bg-white/10" : "bg-white/20",
          "data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full",
          "group-hover:data-[orientation=horizontal]:h-1.5",
          "transition-all duration-150",
          "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1",
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            "absolute transition-colors duration-150",
            "data-[orientation=horizontal]:h-full",
            "data-[orientation=vertical]:w-full",
            isPlaying
              ? "progress-range-playing"
              : "bg-white group-hover:bg-violet-400",
          )}
          style={isPlaying ? {
            background: 'linear-gradient(90deg, #7c3aed, #a855f7, #ec4899, #7c3aed)',
            backgroundSize: '200% 100%',
            animation: 'progress-shimmer 3s linear infinite',
            boxShadow: '0 0 8px rgba(139, 92, 246, 0.6), 0 0 16px rgba(139, 92, 246, 0.3)',
          } : undefined}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "block shrink-0 rounded-full shadow-md",
            isPlaying
              ? "w-3 h-3 bg-white opacity-0 group-hover:opacity-100 shadow-[0_0_6px_rgba(139,92,246,0.8)]"
              : "w-3 h-3 bg-white opacity-0 group-hover:opacity-100",
            "transition-all duration-150",
            "focus-visible:opacity-100 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
