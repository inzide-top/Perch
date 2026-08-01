/**
 * Current request identity boundary.
 *
 * The first version is intentionally single-user, but every service still goes
 * through this function so authentication can replace one boundary later
 * without importing an unrelated domain service.
 */
const demoUserId = 'demo-user'

export async function getCurrentUserId() {
  return demoUserId
}
