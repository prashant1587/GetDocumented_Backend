import { CAPABILITIES } from '../services/accessControl.js';

const BRANDING_SETTINGS_KEY = 'default';

export const defaultBrandingSettings = {
  companyName: '',
  productName: '',
  primaryColor: '#0f172a',
  secondaryColor: '#334155',
  accentColor: '#2563eb',
  fontFamily: 'Helvetica',
  headerLogo: null,
  footerLogo: null,
  headerLogoPosition: 'left',
  headerTitlePlacement: 'center',
  footerText: '',
  footerCompanyInfo: '',
  coverTitle: '',
  coverSubtitle: '',
  watermarkText: 'Internal',
  watermarkEnabled: false,
  tableHeaderBgColor: '#e2e8f0',
  tableBorderColor: '#cbd5e1',
  chartPrimaryColor: '#2563eb',
  chartSecondaryColor: '#0f172a',
  chartAccentColor: '#f59e0b',
  introText: '',
  disclaimerText: '',
  summaryText: '',
  fileNameFormat: '{{documentTitle}}-{{date}}',
  locale: 'en-US',
  currencyCode: 'USD',
  language: 'en',
};

const mergeBrandingSettings = (record) => ({
  ...defaultBrandingSettings,
  ...record,
});

const sanitizeBrandingSettings = (payload = {}) => ({
  companyName: payload.companyName?.trim() || defaultBrandingSettings.companyName,
  productName: payload.productName?.trim() || defaultBrandingSettings.productName,
  primaryColor: payload.primaryColor?.trim() || defaultBrandingSettings.primaryColor,
  secondaryColor: payload.secondaryColor?.trim() || defaultBrandingSettings.secondaryColor,
  accentColor: payload.accentColor?.trim() || defaultBrandingSettings.accentColor,
  fontFamily: payload.fontFamily?.trim() || defaultBrandingSettings.fontFamily,
  headerLogo: payload.headerLogo?.trim() || null,
  footerLogo: payload.footerLogo?.trim() || null,
  headerLogoPosition: payload.headerLogoPosition?.trim() || defaultBrandingSettings.headerLogoPosition,
  headerTitlePlacement: payload.headerTitlePlacement?.trim() || defaultBrandingSettings.headerTitlePlacement,
  footerText: payload.footerText?.trim() || '',
  footerCompanyInfo: payload.footerCompanyInfo?.trim() || '',
  coverTitle: payload.coverTitle?.trim() || '',
  coverSubtitle: payload.coverSubtitle?.trim() || '',
  watermarkText: payload.watermarkText?.trim() || '',
  watermarkEnabled: Boolean(payload.watermarkEnabled),
  tableHeaderBgColor: payload.tableHeaderBgColor?.trim() || defaultBrandingSettings.tableHeaderBgColor,
  tableBorderColor: payload.tableBorderColor?.trim() || defaultBrandingSettings.tableBorderColor,
  chartPrimaryColor: payload.chartPrimaryColor?.trim() || defaultBrandingSettings.chartPrimaryColor,
  chartSecondaryColor: payload.chartSecondaryColor?.trim() || defaultBrandingSettings.chartSecondaryColor,
  chartAccentColor: payload.chartAccentColor?.trim() || defaultBrandingSettings.chartAccentColor,
  introText: payload.introText?.trim() || '',
  disclaimerText: payload.disclaimerText?.trim() || '',
  summaryText: payload.summaryText?.trim() || '',
  fileNameFormat: payload.fileNameFormat?.trim() || defaultBrandingSettings.fileNameFormat,
  locale: payload.locale?.trim() || defaultBrandingSettings.locale,
  currencyCode: payload.currencyCode?.trim() || defaultBrandingSettings.currencyCode,
  language: payload.language?.trim() || defaultBrandingSettings.language,
});

export const getExportBrandingSettings = async (prisma) => {
  const record = await prisma.exportBrandingSettings.findUnique({
    where: { key: BRANDING_SETTINGS_KEY },
  });

  return mergeBrandingSettings(record || {});
};

export default async function exportBrandingRoutes(fastify) {
  fastify.get('/export-branding', { preHandler: fastify.requireCapability(CAPABILITIES.BRANDING_MANAGE) }, async () => {
    return getExportBrandingSettings(fastify.prisma);
  });

  fastify.put('/export-branding', { preHandler: fastify.requireCapability(CAPABILITIES.BRANDING_MANAGE) }, async (request) => {
    const data = sanitizeBrandingSettings(request.body || {});

    const record = await fastify.prisma.exportBrandingSettings.upsert({
      where: { key: BRANDING_SETTINGS_KEY },
      create: {
        key: BRANDING_SETTINGS_KEY,
        ...data,
      },
      update: data,
    });

    return mergeBrandingSettings(record);
  });
}
