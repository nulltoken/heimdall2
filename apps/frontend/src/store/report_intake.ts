/**
 * Reads and parses inspec files
 */

import {InspecDataModule} from '@/store/data_store';
import Store from '@/store/store';
import {Tag} from '@/types/models';
import {read_file_async} from '@/utilities/async_util';
import {
  BurpSuiteMapper,
  DBProtectMapper,
  JfrogXrayMapper,
  NessusResults,
  NetsparkerMapper,
  NiktoMapper,
  SarifMapper,
  ScoutsuiteMapper,
  SnykResults,
  XCCDFResultsMapper,
  ZapMapper
} from '@mitre/hdf-converters';
import {
  ContextualizedEvaluation,
  ContextualizedProfile,
  contextualizeEvaluation,
  contextualizeProfile,
  ConversionResult,
  convertFile,
  ExecJSON
} from 'inspecjs';
import _ from 'lodash';
import {v4 as uuid} from 'uuid';
import {Action, getModule, Module, VuexModule} from 'vuex-module-decorators';
import {FilteredDataModule} from './data_filters';
import {SnackbarModule} from './snackbar';

/** Each FileID corresponds to a unique File in this store */
export type FileID = string;

/** Represents the minimum data to represent an uploaded file handle. */
export type InspecFile = {
  /**
   * Unique identifier for this file. Used to encode which file is currently selected, etc.
   *
   * Note that in general one can assume that if a file A is loaded AFTER a file B, then
   * A.unique_id > B.unique_id.
   * Using this property, one might order files by order in which they were added.
   */
  uniqueId: FileID;
  /** The filename that this file was uploaded under. */
  filename: string;

  database_id?: number;

  tags?: Tag[];

  createdAt?: Date;
  updatedAt?: Date;
};

/** Modify our contextual types to sort of have back-linking to sourced from files */
export interface SourcedContextualizedEvaluation
  extends ContextualizedEvaluation {
  from_file: EvaluationFile;
}

export interface SourcedContextualizedProfile extends ContextualizedProfile {
  from_file: ProfileFile;
}

/** Represents a file containing an Inspec Execution output */
export type EvaluationFile = InspecFile & {
  evaluation: SourcedContextualizedEvaluation;
};

/** Represents a file containing an Inspec Profile (not run) */
export type ProfileFile = InspecFile & {
  profile: SourcedContextualizedProfile;
};

export type FileLoadOptions = {
  /** The file to load */
  file: File;
};

export type TextLoadOptions = {
  /** The filename to denote this object with */
  filename: string;
  database_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  tags?: Tag[];

  /** The text to use for it. */
  text: string;
};

export type ExecJSONLoadOptions = {
  /** The filename to denote this object with */
  filename: string;
  database_id?: string;
  createdAt?: Date;
  updatedAt?: Date;
  tags?: Tag[];
  data: ExecJSON.Execution;
};

// Fields to look for inside of JSON structures to determine type before passing to hdf-converters
export const fileTypeFingerprints = {
  fortify: ['FVDL', 'FVDL.EngineData.EngineVersion', 'FVDL.UUID'],
  jfrog: ['total_count', 'data'],
  nikto: ['banner', 'host', 'ip', 'port', 'vulnerabilities'],
  sarif: ['$schema', 'version', 'runs'],
  snyk: [
    'projectName',
    'policy',
    'summary',
    'vulnerabilities',
    'vulnerabilities[0].identifiers'
  ],
  zap: ['@generated', '@version', 'site']
};

@Module({
  namespaced: true,
  dynamic: true,
  store: Store,
  name: 'intake'
})
export class InspecIntake extends VuexModule {
  /**
   * Load a file with the specified options. Promises an error message on failure
   */
  @Action
  async loadFile(options: FileLoadOptions): Promise<FileID | FileID[]> {
    const read = await read_file_async(options.file);
    if (await this.isHDF(read)) {
      return this.loadText({
        text: read,
        filename: options.file.name
      });
    } else {
      const converted = await this.convertToHdf({
        fileOptions: options,
        data: read
      });
      if (Array.isArray(converted)) {
        return Promise.all(
          converted.map((evaluation) => {
            return this.loadExecJson({
              data: evaluation,
              filename: options.file.name
            });
          })
        );
      } else if (converted) {
        return this.loadExecJson({
          data: converted,
          filename: options.file.name
        });
      } else {
        return [];
      }
    }
  }

  @Action
  async isHDF(data: string): Promise<boolean> {
    try {
      // If our data loads correctly it could be HDF
      const parsed = JSON.parse(data);
      return (
        Array.isArray(parsed.profiles) || // Execution JSON
        (Boolean(parsed.controls) && Boolean(parsed.sha256)) // Profile JSON
      );
    } catch {
      // HDF isn't valid json, we have a different format
      return false;
    }
  }

  @Action
  async convertToHdf(convertOptions: {
    fileOptions: FileLoadOptions;
    data: string;
  }): Promise<ExecJSON.Execution | ExecJSON.Execution[] | void> {
    try {
      const parsed = JSON.parse(convertOptions.data);
      // If the data passed is valid json, try to match up known keys
      const typeGuess = await this.guessType(parsed);
      if (typeGuess === 'jfrog') {
        return new JfrogXrayMapper(convertOptions.data).toHdf();
      } else if (typeGuess === 'zap') {
        return new ZapMapper(convertOptions.data).toHdf();
      } else if (typeGuess === 'nikto') {
        return new NiktoMapper(convertOptions.data).toHdf();
      } else if (typeGuess === 'sarif') {
        return new SarifMapper(convertOptions.data).toHdf();
      } else if (typeGuess === 'snyk') {
        return new SnykResults(convertOptions.data).toHdf();
      }
    } catch {
      // If we don't have JSON, fall back to checking strings inside of the text
      // Nessus
      if (
        convertOptions.fileOptions.file.name.toLowerCase().endsWith('.nessus')
      ) {
        return new NessusResults(convertOptions.data).toHdf();
      }
      // XCCDF Results
      else if (
        // If the file contains the Checklist schema or has xccdf in the filename
        convertOptions.data.indexOf(
          'schemaLocation="http://checklists.nist.gov/xccdf'
        ) !== -1 ||
        convertOptions.fileOptions.file.name.toLowerCase().indexOf('xccdf') !==
          -1
      ) {
        return new XCCDFResultsMapper(convertOptions.data).toHdf();
      }
      // Burp Suite
      else if (convertOptions.data.indexOf('issues burpVersion') !== -1) {
        return new BurpSuiteMapper(convertOptions.data).toHdf();
      }
      // Scoutsuite
      else if (convertOptions.data.indexOf('scoutsuite_results') !== -1) {
        return new ScoutsuiteMapper(convertOptions.data).toHdf();
      }
      // DBProtect
      else if (
        convertOptions.data.indexOf('Policy') !== -1 &&
        convertOptions.data.indexOf('Job Name') !== -1 &&
        convertOptions.data.indexOf('Check ID') !== -1 &&
        convertOptions.data.indexOf('Result Status')
      ) {
        return new DBProtectMapper(convertOptions.data).toHdf();
      } else if (convertOptions.data.indexOf('netsparker-enterprise')) {
        return new NetsparkerMapper(convertOptions.data).toHdf();
      }
    }
    return SnackbarModule.failure(
      'Invalid file uploaded, no fingerprints matched.'
    );
  }

  @Action
  async guessType(parsedJSON: Record<string, unknown>): Promise<string> {
    // Find the fingerprints that have the most matches
    const fingerprinted = Object.entries(fileTypeFingerprints).reduce(
      (a, b) => {
        return a[1].filter((value) => _.get(parsedJSON, value)).length >
          b[1].filter((value) => _.get(parsedJSON, value)).length
          ? a
          : b;
      }
    );
    return fingerprinted[0];
  }

  @Action
  async loadText(options: TextLoadOptions): Promise<FileID> {
    // Convert it
    const fileID: FileID = uuid();
    const result: ConversionResult = convertFile(options.text, true);
    // Determine what sort of file we (hopefully) have, then add it
    if (result['1_0_ExecJson']) {
      // A bit of chicken and egg here
      const evalFile = {
        uniqueId: fileID,
        filename: options.filename,
        database_id: options.database_id,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt,
        tags: options.tags
        // evaluation
      } as EvaluationFile;

      // Fixup the evaluation to be Sourced from a file. Requires a temporary type break
      const evaluation = contextualizeEvaluation(
        result['1_0_ExecJson']
      ) as unknown as SourcedContextualizedEvaluation;
      evaluation.from_file = evalFile;

      // Set and freeze
      evalFile.evaluation = evaluation;
      Object.freeze(evaluation);
      InspecDataModule.addExecution(evalFile);
      FilteredDataModule.toggle_evaluation(evalFile.uniqueId);
    } else if (result['1_0_ProfileJson']) {
      // Handle as profile
      const profileFile = {
        uniqueId: fileID,
        filename: options.filename
      } as ProfileFile;

      // Fixup the evaluation to be Sourced from a file. Requires a temporary type break
      const profile = contextualizeProfile(
        result['1_0_ProfileJson']
      ) as unknown as SourcedContextualizedProfile;
      profile.from_file = profileFile;

      // Set and freeze
      profileFile.profile = profile;
      Object.freeze(profile);
      InspecDataModule.addProfile(profileFile);
      FilteredDataModule.toggle_profile(profileFile.uniqueId);
    } else {
      // eslint-disable-next-line no-console
      console.error(result.errors);
      throw new Error(
        "Couldn't parse data. See developer's tools for more details."
      );
    }
    return fileID;
  }

  // Instead of re-stringifying converted evaluations, add the allow loading the ExecJSON directly.
  @Action
  async loadExecJson(options: ExecJSONLoadOptions) {
    // Convert it
    const fileID: FileID = uuid();
    // A bit of chicken and egg here, this will be our circular JSON structure
    const evalFile = {
      uniqueId: fileID,
      filename: options.filename,
      database_id: options.database_id,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
      tags: options.tags
    } as EvaluationFile;

    // Fixup the evaluation to be Sourced from a file.
    const evaluation = contextualizeEvaluation(
      options.data
    ) as SourcedContextualizedEvaluation;
    evaluation.from_file = evalFile;

    // Set and freeze
    evalFile.evaluation = evaluation;
    Object.freeze(evaluation);
    InspecDataModule.addExecution(evalFile);
    FilteredDataModule.toggle_evaluation(evalFile.uniqueId);

    return fileID;
  }
}

export const InspecIntakeModule = getModule(InspecIntake);
