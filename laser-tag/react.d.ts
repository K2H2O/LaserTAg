import 'react';

declare module 'react' {
  interface CanvasHTMLAttributes<T> extends React.HTMLAttributes<T> {
    willreadfrequently?: boolean;
  }
}