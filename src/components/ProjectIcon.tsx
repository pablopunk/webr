import { useEffect, useRef, useState } from 'react';
import type { Project } from '../lib/models';

export function ProjectIcon({ project }: { project: Project }) {
  const image = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.current?.complete) {
      setLoaded(image.current.naturalWidth > 0);
      setFailed(image.current.naturalWidth === 0);
    }
  }, [project.iconUrl]);

  return <span className={`thread-project ${loaded ? 'has-icon' : ''}`} style={{ '--project-color': project.color } as React.CSSProperties} aria-hidden="true">
    <span className="thread-project-letter">{project.initial}</span>
    {project.iconUrl && !failed && <img ref={image} src={project.iconUrl} alt="" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
  </span>;
}
