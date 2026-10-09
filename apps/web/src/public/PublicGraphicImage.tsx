import { useState } from "react";

export function PublicGraphicImage({
  alt,
  className,
  src,
  wrapperClassName,
}: {
  readonly alt: string;
  readonly className?: string;
  readonly src?: string | null | undefined;
  readonly wrapperClassName?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  if (!src || failedSrc === src) {
    return null;
  }

  const image = (
    <img
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        setFailedSrc(src);
      }}
      onLoad={() => {
        setLoaded(true);
      }}
      src={src}
    />
  );

  if (!wrapperClassName) {
    return image;
  }

  return (
    <div className={`${wrapperClassName}${loaded ? " is-loaded" : " is-loading"}`}>{image}</div>
  );
}
