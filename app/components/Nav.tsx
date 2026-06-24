'use client';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/',        label: 'Home'    },
  { href: '/chat',    label: 'Chat'    },
  { href: '/learned', label: 'Learned' },
  { href: '/plan',    label: 'Plan'    },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div style={{ display: 'flex', gap: 4 }}>
        {LINKS.map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className={`nav-link${path === href ? ' active' : ''}`}
          >
            {label}
          </a>
        ))}
      </div>
      <a href="/" className="nav-logo">🇸🇪 Passet</a>
    </nav>
  );
}
