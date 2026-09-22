import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type RouterValue = { path: string; segments: string[]; query: URLSearchParams; navigate: (to: string) => void };
const RouterContext = createContext<RouterValue>({ path: '/', segments: [], query: new URLSearchParams(), navigate: () => {} });

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(currentPath());

  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) window.location.hash = '/';
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const value = useMemo<RouterValue>(() => {
    const [pathname, search = ''] = path.split('?');
    return {
      path: pathname,
      segments: pathname.split('/').filter(Boolean),
      query: new URLSearchParams(search),
      navigate: (to: string) => {
        window.location.hash = to.startsWith('/') ? to : `/${to}`;
        window.scrollTo({ top: 0 });
      },
    };
  }, [path]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  return useContext(RouterContext);
}

export function Link({ to, className, children, onClick, title }: { to: string; className?: string; children: React.ReactNode; onClick?: () => void; title?: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={`#${to}`}
      className={className}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}
