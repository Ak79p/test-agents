import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="empty-state not-found" data-testid="not-found-page">
      <h1>Page not found</h1>
      <p className="muted">The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn btn-primary">
        Go to dashboard
      </Link>
    </div>
  );
}
