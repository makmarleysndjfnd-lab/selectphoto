const fs = require('fs');
const path = 'backend/src/routes/teams.ts';

let content = fs.readFileSync(path, 'utf8');

const newRoute = `// Create team (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { name, type } = req.body;
  try {
    const companyId = req.user?.companyId;

    // Generate prefix automatically: find highest EQ-XXX
    const existingTeams = await prisma.team.findMany({
      where: { companyId },
      select: { prefix: true }
    });

    let maxNum = 0;
    for (const t of existingTeams) {
      if (t.prefix && t.prefix.startsWith('EQ-')) {
        const numStr = t.prefix.replace('EQ-', '');
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    const nextNum = maxNum + 1;
    const generatedPrefix = \`EQ-\${nextNum.toString().padStart(3, '0')}\`;

    const newTeam = await prisma.team.create({
      data: { name, prefix: generatedPrefix, type: type || 'PRODUCTION', companyId }
    });
    res.status(201).json(newTeam);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create team.' });
  }
});`;

content = content.replace(
  /\/\/ Create team \(Admin only\)\nrouter\.post\('\/', authenticateToken, requireAdmin, async \(req: AuthRequest, res: Response\) => \{[\s\S]*?\}\);/m,
  newRoute
);

fs.writeFileSync(path, content, 'utf8');
console.log('patched teams.ts');
