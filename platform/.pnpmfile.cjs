// @prisma/client déclare `prisma` et `typescript` comme peers optionnels. Comme l'API a les deux
// en devDependencies, pnpm les résout et les garde dans l'installation de production : le CLI
// Prisma, Prisma Studio, PGlite, TypeScript... environ 200 Mo dans l'image, jamais exécutés.
// On retire ces peers : le client généré n'en a pas besoin pour tourner.
function readPackage(pkg) {
  if (pkg.name === '@prisma/client') {
    delete pkg.peerDependencies
    delete pkg.peerDependenciesMeta
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
