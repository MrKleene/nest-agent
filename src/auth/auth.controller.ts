import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { User } from '../user/interfaces/user.interface.js';
import { AuthService } from './auth.service.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { loginSchema, type LoginDto } from './dto/login.dto.js';
import { registerSchema, type RegisterDto } from './dto/register.dto.js';
import { OriginGuard } from './guards/origin.guard.js';
import type { SessionTokens } from './interfaces/session-tokens.interface.js';

@Controller('auth')
@UseGuards(OriginGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Post('register')
  @Public()
  register(
    @Body({ schema: registerSchema })
    registerDto: RegisterDto,
  ): Promise<User> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema })
    loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.authService.login(loginDto);
    return this.tokenResponse(response, tokens);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.authCookieService.read(request);
    if (!refreshToken) throw new UnauthorizedException();
    const tokens = await this.authService.refresh(refreshToken);
    return this.tokenResponse(response, tokens);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(
      request.headers.authorization,
      this.authCookieService.read(request),
    );
    this.authCookieService.clear(response);
  }

  @Get('me')
  me(@CurrentUser() user: User): User {
    return user;
  }

  private tokenResponse(response: Response, tokens: SessionTokens) {
    this.authCookieService.write(response, tokens);
    return {
      access_token: tokens.accessToken,
      token_type: 'Bearer' as const,
      expires_in: tokens.expiresIn,
    };
  }
}
