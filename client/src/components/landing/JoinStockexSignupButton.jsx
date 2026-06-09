import { Link } from 'react-router-dom';
import { Button } from '@/components/landing/ui/button';

/** Redirects to the existing user or broker signup page (not a modal). */
export function JoinStockexSignupButton({ account, className, size, children, ...buttonProps }) {
  const href = account.signupHref || '/login?register=true';

  return (
    <Link to={href}>
      <Button size={size} className={className} {...buttonProps}>
        {children}
      </Button>
    </Link>
  );
}
