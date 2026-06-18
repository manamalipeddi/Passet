'use client';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/',        label: 'Today'   },
  { href: '/learned', label: 'Learned' },
  { href: '/plan',    label: 'Plan'    },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {LINKS.map(({ href, label }) => (
        <a
          key={href}
          href={href}
          className={`nav-link${path === href ? ' active' : ''}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
