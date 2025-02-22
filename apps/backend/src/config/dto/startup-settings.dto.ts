import {IStartupSettings} from '@heimdall/interfaces';

export class StartupSettingsDto implements IStartupSettings {
  readonly banner: string;
  readonly classificationBannerColor: string;
  readonly classificationBannerText: string;
  readonly classificationBannerTextColor: string;
  readonly enabledOAuth: string[];
  readonly oidcName: string;
  readonly ldap: boolean;
  readonly registrationEnabled: boolean;

  constructor(settings: IStartupSettings) {
    this.banner = settings.banner;
    this.classificationBannerColor = settings.classificationBannerColor;
    this.classificationBannerText = settings.classificationBannerText;
    this.classificationBannerTextColor = settings.classificationBannerTextColor;
    this.enabledOAuth = settings.enabledOAuth;
    this.oidcName = settings.oidcName;
    this.ldap = settings.ldap;
    this.registrationEnabled = settings.registrationEnabled;
  }
}
