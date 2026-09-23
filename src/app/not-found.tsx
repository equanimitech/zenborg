/**
 * Zenborg - 404 Not Found Page
 */
export default function NotFound() {
  return (
    <div className="h-full bg-stone-50 dark:bg-stone-900 transition-colors flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-stone-900 dark:text-stone-100 mb-2">
          404
        </h1>
        <p className="text-stone-600 dark:text-stone-400">Page not found</p>
      </div>
    </div>
  );
}
