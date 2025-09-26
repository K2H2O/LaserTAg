//2021561648 Bophelo Pharasi
//2023721380 Ivy
import 'react';

declare module 'react' {
  interface CanvasHTMLAttributes<T> extends React.HTMLAttributes<T> {
    willreadfrequently?: boolean;
  }
}