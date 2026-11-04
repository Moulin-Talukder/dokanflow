import { ApiStatus } from '@/components/api-status';

export default function HomePage() {
  return (
    <main className="container">
      <h1>DokanFlow</h1>
      <p className="lead">Point of sale, inventory and customer dues for small retail shops.</p>
      <ApiStatus />
    </main>
  );
}
