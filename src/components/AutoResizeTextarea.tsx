import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import type { ComponentPropsWithoutRef, ForwardedRef, InputEvent as ReactInputEvent } from 'react';

const DEFAULT_MINIMUM_HEIGHT = 44;

const resizeTextareaToContent = (
  textarea: HTMLTextAreaElement,
  minimumHeight = DEFAULT_MINIMUM_HEIGHT,
): number => {
  textarea.style.height = 'auto';
  const nextHeight = Math.max(minimumHeight, textarea.scrollHeight);
  textarea.style.height = `${nextHeight}px`;
  return nextHeight;
};

type AutoResizeTextareaProps = ComponentPropsWithoutRef<'textarea'> & {
  minimumHeight?: number;
};

const assignForwardedRef = (
  ref: ForwardedRef<HTMLTextAreaElement>,
  node: HTMLTextAreaElement | null,
) => {
  if (typeof ref === 'function') {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
};

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  function AutoResizeTextarea({ minimumHeight = DEFAULT_MINIMUM_HEIGHT, onInput, value, defaultValue, ...props }, forwardedRef) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const setTextareaRef = useCallback((node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      assignForwardedRef(forwardedRef, node);
    }, [forwardedRef]);

    useLayoutEffect(() => {
      if (textareaRef.current) resizeTextareaToContent(textareaRef.current, minimumHeight);
    }, [defaultValue, minimumHeight, value]);

    const handleInput = (event: ReactInputEvent<HTMLTextAreaElement>) => {
      resizeTextareaToContent(event.currentTarget, minimumHeight);
      onInput?.(event);
    };

    return (
      <textarea
        {...props}
        ref={setTextareaRef}
        value={value}
        defaultValue={defaultValue}
        onInput={handleInput}
      />
    );
  },
);
