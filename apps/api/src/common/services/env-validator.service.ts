import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomLogger } from './logger.service';

interface EnvValidationRule {
  key: string;
  required: boolean;
  minLength?: number;
  pattern?: RegExp;
  description: string;
}

@Injectable()
export class EnvValidatorService {
  private validatorLogger: CustomLogger;

  private readonly validationRules: EnvValidationRule[] = [
    {
      key: 'NODE_ENV',
      required: true,
      description: 'Application environment',
    },
    {
      key: 'INTERNAL_API_KEY',
      required: false,
      minLength: 10,
      description: 'Internal API key for local service calls',
    },
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: CustomLogger,
  ) {
    this.validatorLogger = this.logger.createLoggerWithContext('EnvValidator');
  }

  validateEnvironment(): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    if (this.configService.get<string>('NOLANX_ALLOW_MOCK_SERVICES') === 'true') {
      return {
        isValid: true,
        errors: [],
        warnings: ['NOLANX_ALLOW_MOCK_SERVICES=true: external service credentials are not enforced.'],
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of this.validationRules) {
      const value = this.configService.get<string>(rule.key);
      const validation = this.validateSingleVar(rule, value);

      if (validation.error) {
        if (rule.required) {
          errors.push(validation.error);
        } else {
          warnings.push(validation.error);
        }
      }
    }

    if (errors.length > 0) {
      this.validatorLogger.error(`Environment validation failed: ${errors.join(', ')}`);
    }

    if (warnings.length > 0) {
      this.validatorLogger.warn(`Environment validation warnings: ${warnings.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateSingleVar(
    rule: EnvValidationRule,
    value: string | undefined,
  ): { error?: string } {
    if (rule.required && !value) {
      return {
        error: `Missing required environment variable: ${rule.key} (${rule.description})`,
      };
    }

    if (!value) {
      return {};
    }

    if (rule.minLength && value.length < rule.minLength) {
      return {
        error: `${rule.key} must be at least ${rule.minLength} characters long`,
      };
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      return {
        error: `${rule.key} format is invalid (${rule.description})`,
      };
    }

    return {};
  }
}
