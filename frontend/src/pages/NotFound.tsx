import { Link } from 'react-router'

export default function NotFound() {
  return (
    <div className="flex items-center justify-center py-16 px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-gray-200">404</h1>
          <div className="text-6xl mb-4">🏀</div>
        </div>
        
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Page Not Found
          </h2>
          <p className="text-gray-600 mb-6">
            Looks like this play didn't make it to the court. The page you're looking for doesn't exist.
          </p>
        </div>
        
        <div className="space-y-4">
          <Link
            to="/"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors duration-200"
          >
            <span className="mr-2">🏠</span>
            Back to Dashboard
          </Link>
          
          <div className="text-sm text-gray-500">
            <Link to="/rankings" className="text-blue-600 hover:text-blue-500 mx-2">
              Rankings
            </Link>
            •
            <Link to="/trade" className="text-blue-600 hover:text-blue-500 mx-2">
              Trade Analyzer
            </Link>
            •
            <Link to="/analytics" className="text-blue-600 hover:text-blue-500 mx-2">
              Analytics
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}