/**
 * Copyright (c) 2026 Diego Patzán. All Rights Reserved.
 *
 * This source code is licensed under a Proprietary License.
 * Unauthorized copying, modification, distribution, or use of this file,
 * via any medium, is strictly prohibited without express written permission.
 *
 * For licensing inquiries: GitHub @dpatzan2
 */

const { prisma } = require('../models/prisma')

const COMPANY_SELECT = {
  id: true, name: true, code: true, tax_id: true, address: true,
  phone: true, logo_url: true, active: true, is_default: true,
}

// GET /api/companies — empresas a las que pertenece el usuario
exports.list = async (req, res, next) => {
  try {
    const rows = await prisma.userCompany.findMany({
      where: { user_id: req.user.sub, company: { active: true } },
      select: { company: { select: COMPANY_SELECT } },
      orderBy: { company: { name: 'asc' } },
    })
    res.json(rows.map((r) => r.company))
  } catch (e) { next(e) }
}

// POST /api/companies — crea empresa + su sucursal principal y agrega al creador
exports.create = async (req, res, next) => {
  try {
    const { name, code, tax_id, address, phone, logo_url, branch_name, branch_code } = req.body || {}
    if (!name || !code) {
      return res.status(400).json({ message: 'name y code son obligatorios' })
    }
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name, code: String(code).toUpperCase(), tax_id, address, phone, logo_url },
        select: COMPANY_SELECT,
      })
      const branch = await tx.branch.create({
        data: {
          company_id: company.id,
          name: branch_name || 'Principal',
          code: String(branch_code || 'PRIN').toUpperCase(),
          is_default: true,
        },
        select: { id: true, name: true, code: true },
      })
      await tx.userCompany.create({ data: { user_id: req.user.sub, company_id: company.id } })
      await tx.userBranch.create({ data: { user_id: req.user.sub, branch_id: branch.id } })
      return { ...company, branches: [branch] }
    })
    res.status(201).json(result)
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe una empresa con ese código' })
    }
    next(e)
  }
}

// PUT /api/companies/:id
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params
    const member = await prisma.userCompany.findUnique({
      where: { user_id_company_id: { user_id: req.user.sub, company_id: id } },
    })
    if (!member) return res.status(403).json({ message: 'Sin acceso a esa empresa' })

    const { name, tax_id, address, phone, logo_url, active } = req.body || {}
    const data = {}
    if (name !== undefined) data.name = name
    if (tax_id !== undefined) data.tax_id = tax_id
    if (address !== undefined) data.address = address
    if (phone !== undefined) data.phone = phone
    if (logo_url !== undefined) data.logo_url = logo_url
    if (active !== undefined) data.active = Boolean(active)

    const company = await prisma.company.update({ where: { id }, data, select: COMPANY_SELECT })
    res.json(company)
  } catch (e) { next(e) }
}

// PUT /api/companies/:id/users — reemplaza los usuarios de la empresa
exports.assignUsers = async (req, res, next) => {
  try {
    const { id } = req.params
    const { user_ids } = req.body || {}
    if (!Array.isArray(user_ids)) {
      return res.status(400).json({ message: 'user_ids debe ser un arreglo' })
    }
    if (!user_ids.includes(req.user.sub)) {
      return res.status(400).json({ message: 'No puedes quitarte a ti mismo de la empresa' })
    }
    const member = await prisma.userCompany.findUnique({
      where: { user_id_company_id: { user_id: req.user.sub, company_id: id } },
    })
    if (!member) return res.status(403).json({ message: 'Sin acceso a esa empresa' })

    await prisma.$transaction(async (tx) => {
      await tx.userCompany.deleteMany({ where: { company_id: id, user_id: { notIn: user_ids } } })
      for (const uid of user_ids) {
        await tx.userCompany.upsert({
          where: { user_id_company_id: { user_id: uid, company_id: id } },
          update: {},
          create: { user_id: uid, company_id: id },
        })
      }
    })
    res.json({ ok: true })
  } catch (e) { next(e) }
}
