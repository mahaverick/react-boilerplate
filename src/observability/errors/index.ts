/**
 * @file Error tracking's public surface: React's root options, the router's
 * route source, and `noteError` for an error screen that catches an error
 * React's root hooks never see.
 */
export { noteError, rootErrorOptions, setErrorRouteSource } from './listen'
