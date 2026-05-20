import "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.ClassAttributes<HTMLElement> & React.HTMLAttributes<HTMLElement> & {
        src?: string;
        controls?: boolean;
        autoplay?: boolean;
        muted?: boolean;
        loop?: boolean;
        width?: number | string;
        height?: number | string;
      };
    }
  }
}
